import type { H3Event } from 'h3'
import { and, asc, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentItems, contentTypes, eventRsvps, sites } from '@nuxflow/db/schema'
import { eventHasStarted, formatEventWhen, parseStoredDate } from '@nuxflow/canvas/events'
import { checkContentAccess } from './content-access'
import { useDb, type Db } from './db'
import { loadEmailConfig } from './email'
import { sendTemplatedEmail } from './email-template'
import { normalizeEmail } from './mailing-list'
import { notifySiteRole } from './notify'
import { publicPathForItem } from './seo'
import { requireSiteId } from './site-context'
import { waitUntil } from './cf-env'
import { hmacSha256Hex, constantTimeEqualHex } from './webhook-crypto'

/**
 * RSVPs for events (`event_rsvps`). A visitor asks for places and gets an email; pressing
 * the button in it confirms the address, and only then does the booking take seats, so
 * made-up addresses can't fill an event. When the event is full they join the waitlist,
 * and a place freed by a cancellation goes to whoever has waited longest.
 *
 * With no email provider set up nothing could ever be confirmed, so the booking takes
 * effect straight away. RSVPs aren't tied to accounts: the address is the identity.
 */

/** Most places one person can ask for. */
export const RSVP_MAX_SEATS = 10

/** A confirmation isn't resent to the same address more often than this. */
const EMAIL_RESEND_INTERVAL_MS = 2 * 60_000

/** Most people moved off a waitlist by one cancellation or capacity change. */
const MAX_PROMOTIONS = 25

export type RsvpRow = typeof eventRsvps.$inferSelect
export type RsvpStatus = RsvpRow['status']
export type RsvpState = 'open' | 'waitlist' | 'closed'

// ── Signed links ────────────────────────────────────────────────────────────
// Same scheme as the mailing list: nothing stored, and bound to its purpose so a link for
// confirming can't cancel.

type LinkPurpose = 'confirm' | 'cancel'

function linkSecret(): string {
  const secret = useRuntimeConfig().betterAuthSecret as string | undefined
  if (!secret) throw new Error('betterAuthSecret is not configured')
  return secret
}

export function rsvpToken(purpose: LinkPurpose, siteId: string, id: string): Promise<string> {
  return hmacSha256Hex(linkSecret(), `event-rsvp:${purpose}:${siteId}:${id}`)
}

async function verifyRsvpToken(purpose: LinkPurpose, siteId: string, id: string, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false
  return constantTimeEqualHex(await rsvpToken(purpose, siteId, id), token)
}

async function rsvpLink(event: H3Event, purpose: LinkPurpose, siteId: string, id: string): Promise<string> {
  const params = new URLSearchParams({ id, token: await rsvpToken(purpose, siteId, id) })
  return `${getRequestURL(event).origin}/rsvp/${purpose}?${params}`
}

// ── The event ───────────────────────────────────────────────────────────────

const EVENT_COLUMNS = {
  id: true,
  slug: true,
  title: true,
  eventStartAt: true,
  eventEndAt: true,
  eventAllDay: true,
  eventLocation: true,
  eventRsvpEnabled: true,
  eventRsvpCapacity: true,
  eventRsvpClosesAt: true,
} as const

export interface RsvpEvent {
  id: string
  slug: string
  title: string
  eventStartAt: string | null
  eventEndAt: string | null
  eventAllDay: boolean | null
  eventLocation: string | null
  eventRsvpEnabled: boolean | null
  eventRsvpCapacity: number | null
  eventRsvpClosesAt: string | null
  timeZone: string
  locale: string
}

/** An event by id, for any status — the admin screens and the links in emails. */
export async function getRsvpEvent(db: Db, siteId: string, id: string): Promise<RsvpEvent | null> {
  const [item, site] = await Promise.all([
    db.query.contentItems.findFirst({
      where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)),
      columns: EVENT_COLUMNS,
    }),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { timezone: true, locale: true } }),
  ])
  if (!item) return null
  return { ...item, timeZone: site?.timezone || 'UTC', locale: site?.locale || 'en' }
}

/**
 * The event a visitor is responding to. A translated page uses its original's list, and
 * the gate is the requested page's own, so a members-only event is RSVP-able only by
 * those who can open it.
 */
export async function getPublicRsvpEvent(event: H3Event, id: string): Promise<RsvpEvent> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const page = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId), eq(contentItems.status, 'published')),
    columns: { id: true, sourceItemId: true, typeId: true, visibility: true, settings: true },
  })
  if (!page) notFound('This event was not found.')
  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.id, page.typeId), eq(contentTypes.siteId, siteId)),
    columns: { slug: true },
  })
  if (type?.slug !== 'event') notFound('This event was not found.')

  const gate = await checkContentAccess(event, { id: page.id, sourceItemId: page.sourceItemId, visibility: page.visibility, settings: page.settings as Record<string, unknown> | null }, siteId)
  if (gate) forbidden('You don\'t have access to this event.')

  const found = await getRsvpEvent(db, siteId, page.sourceItemId ?? page.id)
  if (!found?.eventStartAt) notFound('This event was not found.')
  return found
}

function eventTimes(item: RsvpEvent) {
  return { eventStartAt: item.eventStartAt ?? '', eventEndAt: item.eventEndAt, eventAllDay: item.eventAllDay }
}

/** Sum of the seats per status. */
export async function rsvpCounts(db: Db, siteId: string, itemId: string): Promise<Record<RsvpStatus, number>> {
  const rows = await db
    .select({ status: eventRsvps.status, seats: sql<number>`coalesce(sum(${eventRsvps.seats}), 0)` })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.siteId, siteId), eq(eventRsvps.contentItemId, itemId)))
    .groupBy(eventRsvps.status)
  const counts: Record<RsvpStatus, number> = { pending: 0, confirmed: 0, waitlist: 0, cancelled: 0 }
  for (const row of rows) counts[row.status] = Number(row.seats)
  return counts
}

export function rsvpIsClosed(item: RsvpEvent, now: Date = new Date()): boolean {
  if (!item.eventRsvpEnabled || !item.eventStartAt) return true
  const closesAt = parseStoredDate(item.eventRsvpClosesAt)
  if (closesAt && closesAt.getTime() <= now.getTime()) return true
  return eventHasStarted(eventTimes(item), item.timeZone, now)
}

/** What the event page shows: no personal data, just whether places are left. */
export async function publicRsvpState(event: H3Event, item: RsvpEvent) {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const closed = rsvpIsClosed(item)
  const counts = closed ? null : await rsvpCounts(db, siteId, item.id)
  const spotsLeft = counts && item.eventRsvpCapacity != null ? Math.max(0, item.eventRsvpCapacity - counts.confirmed) : null
  const state: RsvpState = closed ? 'closed' : spotsLeft === 0 || (counts?.waitlist ?? 0) > 0 ? 'waitlist' : 'open'
  return {
    enabled: Boolean(item.eventRsvpEnabled),
    state,
    spotsLeft,
    maxSeats: Math.min(RSVP_MAX_SEATS, item.eventRsvpCapacity ?? RSVP_MAX_SEATS),
  }
}

// ── Taking seats ────────────────────────────────────────────────────────────

// Seats go in one statement, so two people confirming at once can't both take the last
// place: SQLite runs the sum and the update as a single step.
function seatsFit(item: RsvpEvent) {
  const capacity = item.eventRsvpCapacity
  return sql`(
    select coalesce(sum(taken.seats), 0) from event_rsvps taken
    where taken.content_item_id = ${item.id} and taken.status = 'confirmed'
  ) + ${eventRsvps.seats} <= ${capacity}`
}

/** A confirmed address gets its seats, or joins the waitlist. Null if it wasn't pending. */
async function placeRsvp(db: Db, siteId: string, item: RsvpEvent, id: string): Promise<'confirmed' | 'waitlist' | null> {
  const now = new Date().toISOString()
  // Someone already waiting keeps their place ahead of a newcomer, even a smaller party.
  const status = item.eventRsvpCapacity == null
    ? sql`'confirmed'`
    : sql`case when ${seatsFit(item)} and not exists (
        select 1 from event_rsvps waiting
        where waiting.content_item_id = ${item.id} and waiting.status = 'waitlist'
      ) then 'confirmed' else 'waitlist' end`
  const [row] = await db.update(eventRsvps)
    .set({ status: status as never, confirmedAt: now, updatedAt: now })
    .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId), eq(eventRsvps.status, 'pending')))
    .returning({ status: eventRsvps.status })
  return (row?.status as 'confirmed' | 'waitlist' | undefined) ?? null
}

/**
 * Gives freed places to the waitlist, longest wait first. Stops at the first party that
 * doesn't fit rather than skipping ahead to a smaller one. Does nothing once the event
 * has started.
 */
export async function promoteWaitlist(event: H3Event, itemId: string): Promise<number> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const item = await getRsvpEvent(db, siteId, itemId)
  if (!item?.eventStartAt || eventHasStarted(eventTimes(item), item.timeZone)) return 0

  let promoted = 0
  while (promoted < MAX_PROMOTIONS) {
    const next = await db.query.eventRsvps.findFirst({
      where: and(eq(eventRsvps.siteId, siteId), eq(eventRsvps.contentItemId, itemId), eq(eventRsvps.status, 'waitlist')),
      orderBy: [asc(eventRsvps.confirmedAt), asc(eventRsvps.id)],
    })
    if (!next) break
    const [moved] = await db.update(eventRsvps)
      .set({ status: 'confirmed', updatedAt: new Date().toISOString() })
      .where(and(
        eq(eventRsvps.id, next.id),
        eq(eventRsvps.siteId, siteId),
        eq(eventRsvps.status, 'waitlist'),
        item.eventRsvpCapacity == null ? undefined : seatsFit(item),
      ))
      .returning({ id: eventRsvps.id })
    if (!moved) break
    promoted++
    await sendRsvpEmail(event, item, next, 'promoted').catch((err) => {
      console.error('[event-rsvp] Waitlist email failed:', err)
    })
  }
  return promoted
}

// ── Emails ──────────────────────────────────────────────────────────────────

type RsvpEmail = 'confirm' | 'confirmed' | 'waitlist' | 'promoted' | 'cancelled'

async function sendRsvpEmail(event: H3Event, item: RsvpEvent, row: Pick<RsvpRow, 'id' | 'email' | 'seats'>, kind: RsvpEmail): Promise<void> {
  const siteId = requireSiteId(event)
  const when = formatEventWhen(eventTimes(item), item.timeZone, item.locale)
  const origin = getRequestURL(event).origin
  const eventUrl = `${origin}${publicPathForItem({ slug: item.slug }, item.locale)}`
  const details = [when, item.eventLocation].filter((d): d is string => Boolean(d)).join(' · ')
  const places = row.seats === 1 ? '1 place' : `${row.seats} places`
  const cancelNote = 'Can\'t make it after all? Use this link to give up your place: '
  const cancelUrl = kind === 'confirm' ? '' : await rsvpLink(event, 'cancel', siteId, row.id)

  const emails: Record<RsvpEmail, { subject: string; heading: string; body: string; action: { label: string; url: string }; footnote?: string }> = {
    confirm: {
      subject: `Confirm your place: ${item.title}`,
      heading: 'Please confirm your place',
      body: `Someone (hopefully you) asked for ${places} at ${item.title}. One more click and it's done.`,
      action: { label: 'Yes, confirm my place', url: await rsvpLink(event, 'confirm', siteId, row.id) },
      footnote: 'If you didn\'t ask for this, ignore this email and nothing will happen.',
    },
    confirmed: {
      subject: `You're going: ${item.title}`,
      heading: 'You\'re on the list',
      body: `We've saved ${places} for you at ${item.title}.`,
      action: { label: 'View the event', url: eventUrl },
      footnote: `${cancelNote}${cancelUrl}`,
    },
    waitlist: {
      subject: `You're on the waitlist: ${item.title}`,
      heading: 'You\'re on the waitlist',
      body: `${item.title} is full at the moment. We've added you to the waitlist for ${places}, and we'll email you if a place opens up.`,
      action: { label: 'View the event', url: eventUrl },
      footnote: `Don't want to wait? Use this link to leave the waitlist: ${cancelUrl}`,
    },
    promoted: {
      subject: `A place opened up: ${item.title}`,
      heading: 'You\'re off the waitlist',
      body: `Good news: we now have ${places} for you at ${item.title}. You don't need to do anything.`,
      action: { label: 'View the event', url: eventUrl },
      footnote: `${cancelNote}${cancelUrl}`,
    },
    cancelled: {
      subject: `Your place was cancelled: ${item.title}`,
      heading: 'Your place was cancelled',
      body: `The organiser has cancelled your place at ${item.title}. If you think this is a mistake, please get in touch with them.`,
      action: { label: 'View the event', url: eventUrl },
    },
  }
  const email = emails[kind]
  await sendTemplatedEmail(event, {
    to: row.email,
    subject: email.subject,
    category: 'event_rsvp',
    template: {
      preheader: details,
      heading: email.heading,
      paragraphs: [email.body, ...(details ? [details] : [])],
      action: email.action,
      footnote: email.footnote,
    },
  })
}

async function canSendRsvpEmail(event: H3Event): Promise<boolean> {
  const { emailProvider } = await loadEmailConfig(event)
  return Boolean(emailProvider) && emailProvider !== 'console'
}

function notifyTeam(event: H3Event, item: RsvpEvent, title: string, body: string): void {
  waitUntil(event, notifySiteRole(event, {
    siteId: requireSiteId(event),
    minRole: 'editor',
    type: 'event.rsvp',
    title,
    body,
    pushUrl: `/admin/events/${item.id}`,
  }).catch((err) => {
    console.error('[event-rsvp] Team notification failed:', err)
  }))
}

// ── A visitor's RSVP ────────────────────────────────────────────────────────

export interface RsvpInput {
  email: string
  name: string
  seats: number
}

/**
 * Takes an RSVP. With email, the answer is 'pending' whether or not the address was
 * already on the list, so the form can't be used to find out who is coming; someone
 * already booked gets their details again by email instead.
 */
export async function submitRsvp(event: H3Event, item: RsvpEvent, input: RsvpInput): Promise<{ status: 'pending' | 'confirmed' | 'waitlist' }> {
  if (rsvpIsClosed(item)) httpError({ status: 409, message: 'RSVPs for this event are closed.' })
  if (item.eventRsvpCapacity != null && input.seats > item.eventRsvpCapacity) {
    validationError(`This event only has ${item.eventRsvpCapacity} ${item.eventRsvpCapacity === 1 ? 'place' : 'places'} in total.`)
  }

  const db = useDb(event)
  const siteId = requireSiteId(event)
  const email = normalizeEmail(input.email)
  const name = input.name.trim().slice(0, 100)
  const now = new Date().toISOString()

  const existing = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.contentItemId, item.id), eq(eventRsvps.email, email), eq(eventRsvps.siteId, siteId)),
  })
  const withEmail = await canSendRsvpEmail(event)
  const lastSent = existing?.confirmSentAt ? Date.parse(existing.confirmSentAt) : 0
  const mayEmail = Date.now() - lastSent >= EMAIL_RESEND_INTERVAL_MS

  if (existing?.status === 'confirmed' || existing?.status === 'waitlist') {
    if (!withEmail) return { status: existing.status }
    if (mayEmail) {
      await sendRsvpEmail(event, item, existing, existing.status).catch((err) => {
        console.error('[event-rsvp] Reminder email failed:', err)
      })
      await db.update(eventRsvps).set({ confirmSentAt: now })
        .where(and(eq(eventRsvps.id, existing.id), eq(eventRsvps.siteId, siteId)))
    }
    return { status: 'pending' }
  }

  const id = existing?.id ?? ulid()
  if (existing) {
    await db.update(eventRsvps)
      .set({ name, seats: input.seats, status: 'pending', cancelledAt: null, updatedAt: now })
      .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId)))
  }
  else {
    await db.insert(eventRsvps)
      .values({ id, siteId, contentItemId: item.id, email, name, seats: input.seats, status: 'pending' })
      .onConflictDoNothing()
  }

  if (!withEmail) {
    const status = await placeRsvp(db, siteId, item, id)
    if (status) notifyTeam(event, item, `New RSVP: ${item.title}`, `${name} (${input.seats}) ${status === 'waitlist' ? 'joined the waitlist' : 'is coming'}.`)
    return { status: status ?? 'confirmed' }
  }

  if (mayEmail) {
    try {
      await sendRsvpEmail(event, item, { id, email, seats: input.seats }, 'confirm')
    }
    catch (err) {
      // Unlike a list signup, someone is counting on this place: say so and let them retry.
      console.error('[event-rsvp] Confirmation email failed:', err)
      httpError({ status: 502, message: 'We couldn\'t send your confirmation email. Please try again in a few minutes.' })
    }
    await db.update(eventRsvps).set({ confirmSentAt: now })
      .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId)))
  }
  return { status: 'pending' }
}

export interface RsvpLinkResult {
  status: RsvpStatus | 'closed'
  title: string
  when: string
  path: string
}

function linkResult(item: RsvpEvent, status: RsvpLinkResult['status']): RsvpLinkResult {
  return {
    status,
    title: item.title,
    when: formatEventWhen(eventTimes(item), item.timeZone, item.locale),
    path: publicPathForItem({ slug: item.slug }, item.locale),
  }
}

async function rowFromLink(event: H3Event, purpose: LinkPurpose, id: string, token: string): Promise<{ row: RsvpRow; item: RsvpEvent } | null> {
  const siteId = requireSiteId(event)
  if (!(await verifyRsvpToken(purpose, siteId, id, token))) return null
  const db = useDb(event)
  const row = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId)),
  })
  const item = row ? await getRsvpEvent(db, siteId, row.contentItemId) : null
  return row && item ? { row, item } : null
}

/** The button on the emailed confirm page. Null for an unknown row or a bad token. */
export async function confirmRsvp(event: H3Event, id: string, token: string): Promise<RsvpLinkResult | null> {
  const found = await rowFromLink(event, 'confirm', id, token)
  if (!found) return null
  const { row, item } = found
  // A second click is fine, and an old link must not undo a cancellation.
  if (row.status !== 'pending') return linkResult(item, row.status)
  if (rsvpIsClosed(item)) return linkResult(item, 'closed')

  const db = useDb(event)
  const status = await placeRsvp(db, requireSiteId(event), item, id)
  if (!status) return linkResult(item, row.status)
  await sendRsvpEmail(event, item, row, status).catch((err) => {
    console.error('[event-rsvp] Confirmed email failed:', err)
  })
  notifyTeam(event, item, `New RSVP: ${item.title}`, `${row.name} (${row.seats}) ${status === 'waitlist' ? 'joined the waitlist' : 'is coming'}.`)
  return linkResult(item, status)
}

/** The button on the emailed cancel page. Null for an unknown row or a bad token. */
export async function cancelRsvp(event: H3Event, id: string, token: string): Promise<RsvpLinkResult | null> {
  const found = await rowFromLink(event, 'cancel', id, token)
  if (!found) return null
  const { row, item } = found
  if (row.status !== 'cancelled') {
    await setRsvpStatus(event, row, 'cancelled')
    notifyTeam(event, item, `RSVP cancelled: ${item.title}`, `${row.name} (${row.seats}) can no longer come.`)
  }
  return linkResult(item, 'cancelled')
}

// ── Changes by the organiser (and cancellations) ────────────────────────────

/** Changes a booking's status, then offers any place it freed to the waitlist. */
export async function setRsvpStatus(event: H3Event, row: RsvpRow, status: 'confirmed' | 'waitlist' | 'cancelled'): Promise<void> {
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  await useDb(event).update(eventRsvps)
    .set({
      status,
      updatedAt: now,
      cancelledAt: status === 'cancelled' ? now : null,
      confirmedAt: row.confirmedAt ?? now,
    })
    .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId)))
  if (row.status === 'confirmed' && status !== 'confirmed') await promoteWaitlist(event, row.contentItemId)
}

/** Tells a person the organiser changed their booking. Never fails the change itself. */
export async function emailOrganiserChange(event: H3Event, item: RsvpEvent, row: RsvpRow, status: 'confirmed' | 'waitlist' | 'cancelled'): Promise<void> {
  const kind: RsvpEmail = status === 'cancelled' ? 'cancelled' : status === 'waitlist' ? 'waitlist' : row.status === 'waitlist' ? 'promoted' : 'confirmed'
  await sendRsvpEmail(event, item, row, kind).catch((err) => {
    console.error('[event-rsvp] Organiser change email failed:', err)
  })
}

/** Adds someone by hand, e.g. a phone booking. May go over capacity; no email is sent. */
export async function addRsvpByOrganiser(event: H3Event, itemId: string, input: RsvpInput): Promise<string> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const email = normalizeEmail(input.email)
  const existing = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.contentItemId, itemId), eq(eventRsvps.email, email), eq(eventRsvps.siteId, siteId)),
    columns: { id: true, status: true },
  })
  if (existing && existing.status !== 'cancelled') conflict('That address is already on this event\'s list.')

  const now = new Date().toISOString()
  const name = input.name.trim().slice(0, 100)
  if (existing) {
    await db.update(eventRsvps)
      .set({ name, seats: input.seats, status: 'confirmed', confirmedAt: now, cancelledAt: null, updatedAt: now })
      .where(and(eq(eventRsvps.id, existing.id), eq(eventRsvps.siteId, siteId)))
    return existing.id
  }
  const id = ulid()
  await db.insert(eventRsvps).values({ id, siteId, contentItemId: itemId, email, name, seats: input.seats, status: 'confirmed', confirmedAt: now })
  return id
}
