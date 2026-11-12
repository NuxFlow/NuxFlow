import type { H3Event } from 'h3'
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { classPasses, classPassHoldings, contentItems, contentTypes, eventRsvps, sites } from '@nuxflow/db/schema'
import { eventDay, eventHasStarted, formatEventWhen, occurrenceOn, parseStoredDate, upcomingOccurrences, type EventRecurrence } from '@nuxflow/canvas/events'
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
import { getStripeProvider, resolveStripeProvider } from './payments/resolve'
import { bookingAccessLink, bookingOrigin, bookingPaymentsReady, creditsLeft, returnCredits, spendCredits } from './class-passes'
import { refundPayment, withPendingOrder } from './orders'
import { listAppointmentsFor } from './appointments'
import { toMinorUnits } from '../../shared/lib/money'
import type { BookingMethod, CancelTerms, MyBookings, RsvpAnswer, RsvpLinkDetails, RsvpLinkResult, RsvpPublicState, RsvpState } from '../../shared/lib/booking-types'

export type { BookingMethod, CancelTerms, RsvpAnswer, RsvpLinkResult, RsvpState }

/**
 * Bookings for events (`event_rsvps`), free and paid, one-off and repeating.
 *
 * Free: a visitor asks for places and gets an email; pressing the button in it confirms the
 * address, and only then does the booking take seats, so made-up addresses can't fill an
 * event. When it's full they join the waitlist, and a place freed by a cancellation goes to
 * whoever has waited longest.
 *
 * Paid by card: paying proves the address, so there's no email step. The seats are held
 * while the visitor is at Stripe (`held`), and the webhook turns that into a booking.
 *
 * Paid with a class pass: the emailed link is what proves it's their pass, so this goes
 * through the same confirm step as a free booking, and spends the credits at that point.
 *
 * Off a paid event's waitlist, a freed place can't simply be given: it's kept for them for
 * a while (`offered`) and they're emailed a link to pay.
 *
 * With no email provider set up nothing could ever be confirmed, so a free booking takes
 * effect straight away. Bookings aren't tied to accounts: the address is the identity.
 */

/** Most places one person can ask for. */
export const RSVP_MAX_SEATS = 10

/** Next dates of a repeating event offered for booking. */
const BOOKABLE_DATES = 40

/** A confirmation isn't resent to the same address more often than this. */
const EMAIL_RESEND_INTERVAL_MS = 2 * 60_000

/** Most people moved off a waitlist by one cancellation or capacity change. */
const MAX_PROMOTIONS = 25

/** How long a visitor has at Stripe. Its minimum is 30 minutes. */
const CHECKOUT_MINUTES = 31

/** A place is kept a little past the checkout's end, so a last-second payment always has one. */
const HOLD_MS = (CHECKOUT_MINUTES + 5) * 60_000

/** How long someone offered a place off a paid waitlist has to take it. */
const OFFER_MS = 24 * 3_600_000

/** Most bookings handled by one change to an event or one cancelled date. */
const MAX_BOOKINGS_PER_CHANGE = 200

export type RsvpRow = typeof eventRsvps.$inferSelect
export type RsvpStatus = RsvpRow['status']

// ── Signed links ────────────────────────────────────────────────────────────
// Same scheme as the mailing list: nothing stored, and bound to its purpose so a link for
// confirming can't cancel.

type LinkPurpose = 'confirm' | 'cancel' | 'pay'

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
  const page = purpose === 'pay' ? '/booking/pay' : `/rsvp/${purpose}`
  return `${bookingOrigin(event)}${page}?${params}`
}

// ── The event, and one date of it ───────────────────────────────────────────

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
  eventRecurrence: true,
  eventPrice: true,
  eventCurrency: true,
  eventCancelHours: true,
  eventPassesAllowed: true,
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
  eventRecurrence: EventRecurrence | null
  eventPrice: number | null
  eventCurrency: string | null
  eventCancelHours: number | null
  eventPassesAllowed: boolean | null
  timeZone: string
  locale: string
}

/**
 * The event as one bookable date. Its start and end are that date's, so everything that
 * only asks "when is it" works the same for a one-off and for a date of a series.
 */
export interface RsvpSlot extends RsvpEvent {
  /** Empty for a one-off event. */
  occurrenceDate: string
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

function eventTimes(item: Pick<RsvpEvent, 'eventStartAt' | 'eventEndAt' | 'eventAllDay'>) {
  return { eventStartAt: item.eventStartAt ?? '', eventEndAt: item.eventEndAt, eventAllDay: item.eventAllDay }
}

/** One bookable date of an event, or null when a repeating event has no such date. */
export function slotOf(item: RsvpEvent, date: string | null | undefined): RsvpSlot | null {
  if (!item.eventRecurrence) return { ...item, occurrenceDate: '' }
  if (!date) return null
  const occurrence = occurrenceOn(eventTimes(item), item.eventRecurrence, date, item.timeZone)
  if (!occurrence) return null
  return { ...item, occurrenceDate: date, eventStartAt: occurrence.startAt, eventEndAt: occurrence.endAt }
}

/** The date a booking is for. A date since taken out of the series keeps what it had. */
function slotForRow(item: RsvpEvent, row: Pick<RsvpRow, 'occurrenceDate' | 'startsAt'>): RsvpSlot {
  return slotOf(item, row.occurrenceDate)
    ?? { ...item, occurrenceDate: row.occurrenceDate, eventStartAt: row.startsAt ?? item.eventStartAt, eventEndAt: null }
}

export function isPaidEvent(item: Pick<RsvpEvent, 'eventPrice'>): boolean {
  return (item.eventPrice ?? 0) > 0
}

/** Seats per status. Holds and offers whose time is up no longer count as anything. */
async function seatTotals(db: Db, siteId: string, itemId: string, now: string) {
  return db
    .select({
      date: eventRsvps.occurrenceDate,
      status: eventRsvps.status,
      seats: sql<number>`coalesce(sum(${eventRsvps.seats}), 0)`,
    })
    .from(eventRsvps)
    .where(and(
      eq(eventRsvps.siteId, siteId),
      eq(eventRsvps.contentItemId, itemId),
      or(notInArray(eventRsvps.status, ['held', 'offered']), gt(eventRsvps.holdExpiresAt, now)),
    ))
    .groupBy(eventRsvps.occurrenceDate, eventRsvps.status)
}

const noCounts = (): Record<RsvpStatus, number> => ({ pending: 0, held: 0, offered: 0, confirmed: 0, waitlist: 0, cancelled: 0 })

/** Sum of the seats per status, for one date of an event, or all of them with no date. */
export async function rsvpCounts(db: Db, siteId: string, itemId: string, date?: string): Promise<Record<RsvpStatus, number>> {
  const counts = noCounts()
  for (const row of await seatTotals(db, siteId, itemId, new Date().toISOString())) {
    if (date === undefined || row.date === date) counts[row.status] += Number(row.seats)
  }
  return counts
}

export function rsvpIsClosed(item: RsvpSlot, now: Date = new Date()): boolean {
  if (!item.eventRsvpEnabled || !item.eventStartAt) return true
  // A closing date only makes sense for one date; each date of a series closes as it starts.
  const closesAt = item.eventRecurrence ? null : parseStoredDate(item.eventRsvpClosesAt)
  if (closesAt && closesAt.getTime() <= now.getTime()) return true
  return eventHasStarted(eventTimes(item), item.timeZone, now)
}

function slotState(slot: RsvpSlot, counts: Record<RsvpStatus, number>, now: Date) {
  const closed = rsvpIsClosed(slot, now)
  const taken = counts.confirmed + counts.held + counts.offered
  const spotsLeft = !closed && slot.eventRsvpCapacity != null ? Math.max(0, slot.eventRsvpCapacity - taken) : null
  const state: RsvpState = closed ? 'closed' : spotsLeft === 0 || counts.waitlist > 0 ? 'waitlist' : 'open'
  return { state, spotsLeft, maxSeats: Math.min(RSVP_MAX_SEATS, slot.eventRsvpCapacity ?? RSVP_MAX_SEATS) }
}

/** What the event page shows: no personal data, just whether places are left, and how to pay. */
export async function publicRsvpState(event: H3Event, item: RsvpEvent): Promise<RsvpPublicState> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date()
  const paid = isPaidEvent(item)

  const totals = await seatTotals(db, siteId, item.id, now.toISOString())
  const countsFor = (date: string) => {
    const counts = noCounts()
    for (const row of totals) if (row.date === date) counts[row.status] += Number(row.seats)
    return counts
  }

  const canPayByCard = paid && await bookingPaymentsReady(event)
  // Spending credits needs an emailed link, and there's no point offering it with nothing on sale.
  const canUsePass = paid && item.eventPassesAllowed !== false && await canSendRsvpEmail(event)
    && Boolean(await db.query.classPasses.findFirst({ where: eq(classPasses.siteId, siteId), columns: { id: true } }))

  const base = {
    enabled: Boolean(item.eventRsvpEnabled),
    price: paid ? item.eventPrice : null,
    currency: paid ? item.eventCurrency || 'USD' : null,
    canPayByCard,
    canUsePass,
    cancelHours: item.eventCancelHours,
  }

  if (!item.eventRecurrence) {
    const slot = slotOf(item, '')!
    const { state, spotsLeft, maxSeats } = slotState(slot, countsFor(''), now)
    // Paid, with no way of paying set up: better closed than a form that fails at the end.
    return { ...base, state: paid && !canPayByCard && !canUsePass ? 'closed' as const : state, spotsLeft, maxSeats, dates: null }
  }

  const dates = upcomingOccurrences(eventTimes(item), item.eventRecurrence, item.timeZone, BOOKABLE_DATES, now).flatMap((occurrence) => {
    const slot = slotOf(item, occurrence.date)
    if (!slot || rsvpIsClosed(slot, now)) return []
    const when = formatEventWhen(eventTimes(slot), item.timeZone, item.locale)
    return [{ date: occurrence.date, when, ...slotState(slot, countsFor(occurrence.date), now) }]
  })
  const bookable = dates.length > 0 && (!paid || canPayByCard || canUsePass)
  return {
    ...base,
    state: bookable ? 'open' as const : 'closed' as const,
    spotsLeft: null,
    maxSeats: Math.min(RSVP_MAX_SEATS, item.eventRsvpCapacity ?? RSVP_MAX_SEATS),
    dates: bookable ? dates : [],
  }
}

// ── Taking seats ────────────────────────────────────────────────────────────

// Seats go in one statement, so two people confirming at once can't both take the last
// place: SQLite runs the sum and the update as a single step. Holds and offers count until
// their time is up, so someone at Stripe keeps their place. A row asking for seats is
// `pending` or `waitlist`, so it's never counted in its own sum.
function seatsFit(item: RsvpSlot, now: string) {
  const capacity = item.eventRsvpCapacity
  return sql`(
    select coalesce(sum(taken.seats), 0) from event_rsvps taken
    where taken.content_item_id = ${item.id}
      and taken.occurrence_date = ${item.occurrenceDate}
      and (taken.status = 'confirmed' or (taken.status in ('held', 'offered') and taken.hold_expires_at > ${now}))
  ) + ${eventRsvps.seats} <= ${capacity}`
}

// Someone already waiting keeps their place ahead of a newcomer, even a smaller party.
function hasRoom(item: RsvpSlot, now: string) {
  if (item.eventRsvpCapacity == null) return sql`1`
  return sql`(${seatsFit(item, now)} and not exists (
    select 1 from event_rsvps waiting
    where waiting.content_item_id = ${item.id}
      and waiting.occurrence_date = ${item.occurrenceDate}
      and waiting.status = 'waitlist'
  ))`
}

function offerExpiry(slot: RsvpSlot, now: Date): string {
  const start = parseStoredDate(slot.eventStartAt)?.getTime() ?? Number.POSITIVE_INFINITY
  return new Date(Math.min(now.getTime() + OFFER_MS, start)).toISOString()
}

/**
 * A confirmed address gets its seats, or joins the waitlist. On a paid event, seats are only
 * kept for them until they pay (`offered`). Null if it wasn't pending.
 */
async function placeRsvp(db: Db, siteId: string, item: RsvpSlot, id: string, onRoom: 'confirmed' | 'offered'): Promise<'confirmed' | 'offered' | 'waitlist' | null> {
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const room = hasRoom(item, now)
  const [row] = await db.update(eventRsvps)
    .set({
      status: sql`case when ${room} then ${onRoom} else 'waitlist' end` as never,
      holdExpiresAt: onRoom === 'offered' ? sql`case when ${room} then ${offerExpiry(item, nowDate)} else null end` as never : null,
      confirmedAt: now,
      updatedAt: now,
    })
    .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId), eq(eventRsvps.status, 'pending')))
    .returning({ status: eventRsvps.status })
  return (row?.status as 'confirmed' | 'offered' | 'waitlist' | undefined) ?? null
}

/** Moves a pending request to `held`, if there's room. False when there isn't. */
async function holdSeats(db: Db, siteId: string, item: RsvpSlot, id: string): Promise<boolean> {
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const [row] = await db.update(eventRsvps)
    .set({ status: 'held', holdExpiresAt: new Date(nowDate.getTime() + HOLD_MS).toISOString(), updatedAt: now })
    .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId), eq(eventRsvps.status, 'pending'), hasRoom(item, now)))
    .returning({ id: eventRsvps.id })
  return Boolean(row)
}

/**
 * Gives freed places to one date's waitlist, longest wait first. Stops at the first party
 * that doesn't fit rather than skipping ahead to a smaller one. On a free event they simply
 * get the place. On a paid one it's kept for them to pay for. Does nothing once it has started.
 */
export async function promoteWaitlist(event: H3Event, itemId: string, date = ''): Promise<number> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const series = await getRsvpEvent(db, siteId, itemId)
  const item = series ? slotOf(series, date) : null
  if (!item?.eventStartAt || eventHasStarted(eventTimes(item), item.timeZone)) return 0
  const paid = isPaidEvent(item)

  let promoted = 0
  while (promoted < MAX_PROMOTIONS) {
    const next = await db.query.eventRsvps.findFirst({
      where: and(eq(eventRsvps.siteId, siteId), eq(eventRsvps.contentItemId, itemId), eq(eventRsvps.occurrenceDate, date), eq(eventRsvps.status, 'waitlist')),
      orderBy: [asc(eventRsvps.confirmedAt), asc(eventRsvps.id)],
    })
    if (!next) break
    const nowDate = new Date()
    const now = nowDate.toISOString()
    const [moved] = await db.update(eventRsvps)
      .set(paid
        ? { status: 'offered', holdExpiresAt: offerExpiry(item, nowDate), updatedAt: now }
        : { status: 'confirmed', updatedAt: now })
      .where(and(
        eq(eventRsvps.id, next.id),
        eq(eventRsvps.siteId, siteId),
        eq(eventRsvps.status, 'waitlist'),
        item.eventRsvpCapacity == null ? undefined : seatsFit(item, now),
      ))
      .returning({ id: eventRsvps.id })
    if (!moved) break
    promoted++
    await sendRsvpEmail(event, item, next, paid ? 'offer' : 'promoted').catch((err) => {
      console.error('[event-rsvp] Waitlist email failed:', err)
    })
  }
  return promoted
}

/** Every date of an event that has people waiting, after a change that could free places. */
export async function promoteAllWaitlists(event: H3Event, itemId: string): Promise<void> {
  const db = useDb(event)
  const rows = await db.selectDistinct({ date: eventRsvps.occurrenceDate }).from(eventRsvps)
    .where(and(eq(eventRsvps.siteId, requireSiteId(event)), eq(eventRsvps.contentItemId, itemId), eq(eventRsvps.status, 'waitlist')))
  for (const { date } of rows) await promoteWaitlist(event, itemId, date)
}

// ── Emails ──────────────────────────────────────────────────────────────────

type RsvpEmail = 'confirm' | 'confirm_pass' | 'confirmed' | 'paid' | 'waitlist' | 'promoted' | 'offer' | 'offer_expired'
  | 'cancelled' | 'date_cancelled' | 'changed' | 'reminder' | 'no_place_refunded'

/** How a booking's money or credits came back, for the wording of the email. */
type RefundNote = 'card' | 'pass' | null

function cancelPolicy(item: RsvpSlot): string {
  if (!isPaidEvent(item) || !item.eventCancelHours) return ''
  const hours = item.eventCancelHours
  const notice = hours % 24 === 0 ? `${hours / 24} ${hours === 24 ? 'day' : 'days'}` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  return ` You can cancel for a refund up to ${notice} before it starts.`
}

async function sendRsvpEmail(event: H3Event, item: RsvpSlot, row: Pick<RsvpRow, 'id' | 'email' | 'seats'>, kind: RsvpEmail, refund: RefundNote = null): Promise<void> {
  const siteId = requireSiteId(event)
  const when = formatEventWhen(eventTimes(item), item.timeZone, item.locale)
  const origin = bookingOrigin(event)
  const dateQuery = item.occurrenceDate ? `?date=${item.occurrenceDate}` : ''
  const eventUrl = `${origin}${publicPathForItem({ slug: item.slug }, item.locale)}${dateQuery}`
  const details = [when, item.eventLocation].filter((d): d is string => Boolean(d)).join(' · ')
  const places = row.seats === 1 ? '1 place' : `${row.seats} places`
  const cancelNote = `Can't make it after all? Use this link to give up your place:${cancelPolicy(item)} `
  const hasPlace = kind === 'confirmed' || kind === 'paid' || kind === 'promoted' || kind === 'waitlist' || kind === 'changed' || kind === 'reminder'
  const cancelUrl = hasPlace ? await rsvpLink(event, 'cancel', siteId, row.id) : ''
  const refundLine = refund === 'card'
    ? ' Your payment has been refunded; it can take a few days to reach your account.'
    : refund === 'pass' ? ' The sessions have gone back on your pass.' : ''
  const view = { label: 'View the event', url: eventUrl }

  const emails: Record<RsvpEmail, { subject: string; heading: string; body: string; action: { label: string; url: string }; footnote?: string }> = {
    confirm: {
      subject: `Confirm your place: ${item.title}`,
      heading: 'Please confirm your place',
      body: `Someone (hopefully you) asked for ${places} at ${item.title}. One more click and it's done.`,
      action: { label: 'Yes, confirm my place', url: await rsvpLink(event, 'confirm', siteId, row.id) },
      footnote: 'If you didn\'t ask for this, ignore this email and nothing will happen.',
    },
    confirm_pass: {
      subject: `Use your pass: ${item.title}`,
      heading: 'Use your class pass?',
      body: `Someone (hopefully you) asked to book ${places} at ${item.title} using a class pass on this address. This will use ${row.seats === 1 ? '1 session' : `${row.seats} sessions`} from your pass.`,
      action: { label: 'Yes, use my pass', url: await rsvpLink(event, 'confirm', siteId, row.id) },
      footnote: 'If you didn\'t ask for this, ignore this email and no sessions will be used.',
    },
    confirmed: {
      subject: `You're going: ${item.title}`,
      heading: 'You\'re on the list',
      body: `We've saved ${places} for you at ${item.title}.`,
      action: view,
      footnote: `${cancelNote}${cancelUrl}`,
    },
    paid: {
      subject: `You're booked: ${item.title}`,
      heading: 'You\'re booked',
      body: `Thanks. We've got ${places} for you at ${item.title}.`,
      action: view,
      footnote: `${cancelNote}${cancelUrl}`,
    },
    waitlist: {
      subject: `You're on the waitlist: ${item.title}`,
      heading: 'You\'re on the waitlist',
      body: `${item.title} is full at the moment. We've added you to the waitlist for ${places}, and we'll email you if a place opens up.`,
      action: view,
      footnote: `Don't want to wait? Use this link to leave the waitlist: ${cancelUrl}`,
    },
    promoted: {
      subject: `A place opened up: ${item.title}`,
      heading: 'You\'re off the waitlist',
      body: `Good news: we now have ${places} for you at ${item.title}. You don't need to do anything.`,
      action: view,
      footnote: `${cancelNote}${cancelUrl}`,
    },
    offer: {
      subject: `A place opened up: ${item.title}`,
      heading: 'A place opened up',
      body: `Good news: we're keeping ${places} for you at ${item.title}. It's yours if you book within the next 24 hours, or before it starts if that's sooner.`,
      action: { label: 'Book my place', url: await rsvpLink(event, 'pay', siteId, row.id) },
      footnote: 'If you don\'t want it, do nothing and it will go to the next person.',
    },
    offer_expired: {
      subject: `Your place has been released: ${item.title}`,
      heading: 'Your place has been released',
      body: `We kept a place for you at ${item.title}, but it wasn't booked in time, so it has gone to the next person.`,
      action: view,
    },
    cancelled: {
      subject: `Your place was cancelled: ${item.title}`,
      heading: 'Your place was cancelled',
      body: `Your place at ${item.title} has been cancelled.${refundLine} If you think this is a mistake, please get in touch.`,
      action: view,
    },
    date_cancelled: {
      subject: `Cancelled: ${item.title}`,
      heading: 'This session has been cancelled',
      body: `We're sorry, ${item.title} won't be going ahead on this date.${refundLine}`,
      action: view,
    },
    changed: {
      subject: `Details changed: ${item.title}`,
      heading: 'The details have changed',
      body: `The time or place of ${item.title} has changed. The latest details are below.`,
      action: view,
      footnote: `${cancelNote}${cancelUrl}`,
    },
    reminder: {
      subject: `Reminder: ${item.title}`,
      heading: 'See you soon',
      body: `This is a reminder that you have ${places} at ${item.title}.`,
      action: view,
      footnote: `${cancelNote}${cancelUrl}`,
    },
    no_place_refunded: {
      subject: `We've refunded you: ${item.title}`,
      heading: 'We couldn\'t keep your place',
      body: `We received your payment for ${item.title}, but the place was no longer available, so we've refunded you in full. It can take a few days to reach your account.`,
      action: view,
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

// ── A visitor's booking ─────────────────────────────────────────────────────

export interface RsvpInput {
  email: string
  name: string
  seats: number
  /** Paid events only: how they want to pay. */
  method?: BookingMethod
}

/** Everything about a previous attempt that a new one starts over. */
const FRESH_BOOKING = {
  status: 'pending',
  cancelledAt: null,
  holdExpiresAt: null,
  paymentStatus: null,
  amountPaid: null,
  currency: null,
  stripeSessionId: null,
  stripePaymentIntentId: null,
  passHoldingId: null,
  creditsSpent: 0,
  reminderSentAt: null,
} as const

/** Sends someone to Stripe for seats already kept for them. */
async function openCheckout(event: H3Event, slot: RsvpSlot, row: Pick<RsvpRow, 'id' | 'email' | 'seats'> & { name?: string }): Promise<string> {
  const siteId = requireSiteId(event)
  const stripe = await getStripeProvider(event)
  const origin = bookingOrigin(event)
  const when = formatEventWhen(eventTimes(slot), slot.timeZone, slot.locale)
  const dateQuery = slot.occurrenceDate ? `?date=${slot.occurrenceDate}` : ''
  const currency = slot.eventCurrency || 'USD'
  const order = {
    email: row.email,
    name: row.name ?? '',
    currency,
    lines: [{ kind: 'booking' as const, refId: slot.id, recordId: row.id, name: slot.title, description: when, quantity: row.seats, unitMinor: toMinorUnits(slot.eventPrice ?? 0, currency) }],
  }
  const session = await withPendingOrder(event, order, ({ id: orderId }) => stripe.createPaymentCheckout({
    customerEmail: row.email,
    item: {
      name: slot.title,
      description: when,
      amount: slot.eventPrice ?? 0,
      currency,
      quantity: row.seats,
    },
    successUrl: `${origin}/booking/thanks?type=class`,
    cancelUrl: `${origin}${publicPathForItem({ slug: slot.slug }, slot.locale)}${dateQuery}`,
    metadata: { nuxflowKind: 'booking', siteId, rsvpId: row.id, orderId },
    expiresInMinutes: CHECKOUT_MINUTES,
  }))
  await useDb(event).update(eventRsvps)
    .set({ stripeSessionId: session.id, paymentMethod: 'card', updatedAt: new Date().toISOString() })
    .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId)))
  if (!session.url) throw new Error('Stripe returned no checkout address')
  return session.url
}

/**
 * Takes a booking. With email, the answer is 'pending' whether or not the address was
 * already on the list, so the form can't be used to find out who is coming; someone
 * already booked gets their details again by email instead. A card booking that gets seats
 * is the one exception: it's `checkout`, with where to pay.
 */
export async function submitRsvp(event: H3Event, item: RsvpSlot, input: RsvpInput): Promise<RsvpAnswer> {
  if (rsvpIsClosed(item)) httpError({ status: 409, message: 'RSVPs for this event are closed.' })
  if (item.eventRsvpCapacity != null && input.seats > item.eventRsvpCapacity) {
    validationError(`This event only has ${item.eventRsvpCapacity} ${item.eventRsvpCapacity === 1 ? 'place' : 'places'} in total.`)
  }

  const db = useDb(event)
  const siteId = requireSiteId(event)
  const email = normalizeEmail(input.email)
  const name = input.name.trim().slice(0, 100)
  const now = new Date().toISOString()
  const paid = isPaidEvent(item)
  const method: BookingMethod | null = paid ? input.method ?? 'card' : null

  if (method === 'card' && !(await bookingPaymentsReady(event))) {
    httpError({ status: 503, message: 'Online payments aren\'t available right now.' })
  }
  if (method === 'pass' && item.eventPassesAllowed === false) validationError('This event can\'t be booked with a class pass.')

  const existing = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.contentItemId, item.id), eq(eventRsvps.occurrenceDate, item.occurrenceDate), eq(eventRsvps.email, email), eq(eventRsvps.siteId, siteId)),
  })
  const withEmail = await canSendRsvpEmail(event)
  const lastSent = existing?.confirmSentAt ? Date.parse(existing.confirmSentAt) : 0
  const mayEmail = Date.now() - lastSent >= EMAIL_RESEND_INTERVAL_MS

  if (method === 'pass' && !withEmail) httpError({ status: 503, message: 'Class passes can\'t be used right now.' })

  if (existing?.status === 'confirmed' || existing?.status === 'waitlist' || existing?.status === 'offered') {
    if (!withEmail) return { status: existing.status === 'offered' ? 'waitlist' : existing.status }
    if (mayEmail) {
      const kind: RsvpEmail = existing.status === 'offered' ? 'offer' : existing.status
      await sendRsvpEmail(event, item, existing, kind).catch((err) => {
        console.error('[event-rsvp] Reminder email failed:', err)
      })
      await db.update(eventRsvps).set({ confirmSentAt: now })
        .where(and(eq(eventRsvps.id, existing.id), eq(eventRsvps.siteId, siteId)))
    }
    return { status: 'pending' }
  }

  // Back from a checkout they didn't finish. If that one has been paid after all, its webhook
  // is on the way and a second charge would be wrong; otherwise close it, so a payment can't
  // land on it once this attempt has moved on.
  if (existing?.status === 'held' && existing.stripeSessionId) {
    const stripe = await resolveStripeProvider(event)
    const old = await stripe?.getCheckoutSession(existing.stripeSessionId).catch(() => null)
    if (old?.status === 'complete') return { status: 'pending' }
    if (old?.status === 'open') await stripe?.expireCheckoutSession(old.id).catch(() => null)
  }

  const id = existing?.id ?? ulid()
  const startsAt = item.eventStartAt
  if (existing) {
    await db.update(eventRsvps)
      .set({ ...FRESH_BOOKING, name, seats: input.seats, paymentMethod: method, startsAt, updatedAt: now })
      .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId)))
  }
  else {
    await db.insert(eventRsvps)
      .values({ id, siteId, contentItemId: item.id, occurrenceDate: item.occurrenceDate, startsAt, email, name, seats: input.seats, status: 'pending', paymentMethod: method })
      .onConflictDoNothing()
  }

  if (method === 'card' && await holdSeats(db, siteId, item, id)) {
    try {
      return { status: 'checkout', url: await openCheckout(event, item, { id, email, name, seats: input.seats }) }
    }
    catch (err) {
      console.error('[event-rsvp] Checkout failed:', err)
      await db.update(eventRsvps)
        .set({ status: 'cancelled', cancelledAt: now, holdExpiresAt: null, updatedAt: now })
        .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId)))
      httpError({ status: 502, message: 'We couldn\'t reach the payment provider. Please try again in a few minutes.' })
    }
  }

  // A waitlist on a paid event works by emailing an offer, which can't happen with no email.
  if (paid && !withEmail) httpError({ status: 409, message: 'This date is full.' })

  if (!withEmail) {
    const status = await placeRsvp(db, siteId, item, id, 'confirmed')
    if (status) notifyTeam(event, item, `New RSVP: ${item.title}`, `${name} (${input.seats}) ${status === 'waitlist' ? 'joined the waitlist' : 'is coming'}.`)
    return { status: status === 'waitlist' ? 'waitlist' : 'confirmed' }
  }

  if (mayEmail) {
    try {
      await sendRsvpEmail(event, item, { id, email, seats: input.seats }, method === 'pass' ? 'confirm_pass' : 'confirm')
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

function linkResult(item: RsvpSlot, status: RsvpLinkResult['status'], extra: Partial<RsvpLinkResult> = {}): RsvpLinkResult {
  const dateQuery = item.occurrenceDate ? `?date=${item.occurrenceDate}` : ''
  return {
    status,
    title: item.title,
    when: formatEventWhen(eventTimes(item), item.timeZone, item.locale),
    path: `${publicPathForItem({ slug: item.slug }, item.locale)}${dateQuery}`,
    ...extra,
  }
}

async function rowFromLink(event: H3Event, purpose: LinkPurpose, id: string, token: string): Promise<{ row: RsvpRow; item: RsvpSlot } | null> {
  const siteId = requireSiteId(event)
  if (!(await verifyRsvpToken(purpose, siteId, id, token))) return null
  const db = useDb(event)
  const row = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId)),
  })
  const series = row ? await getRsvpEvent(db, siteId, row.contentItemId) : null
  return row && series ? { row, item: slotForRow(series, row) } : null
}

// Paying with a pass, from a link that proved the address: credits go first, because if
// anything then fails they can be given back, where seats given away can't be charged for.

async function markPaidByPass(db: Db, siteId: string, rowId: string, holdingId: string, credits: number, now: string) {
  await db.update(eventRsvps)
    .set({ paymentMethod: 'pass', paymentStatus: 'paid', passHoldingId: holdingId, creditsSpent: credits, holdExpiresAt: null, updatedAt: now })
    .where(and(eq(eventRsvps.id, rowId), eq(eventRsvps.siteId, siteId)))
}

/** The button on the emailed confirm page. Null for an unknown row or a bad token. */
export async function confirmRsvp(event: H3Event, id: string, token: string): Promise<RsvpLinkResult | null> {
  const found = await rowFromLink(event, 'confirm', id, token)
  if (!found) return null
  const { row, item } = found
  const siteId = requireSiteId(event)
  // A second click is fine, and an old link must not undo a cancellation.
  if (row.status !== 'pending') {
    return linkResult(item, row.status, row.status === 'offered' ? { payUrl: await rsvpLink(event, 'pay', siteId, row.id) } : {})
  }
  if (rsvpIsClosed(item)) return linkResult(item, 'closed')

  const db = useDb(event)

  if (row.paymentMethod === 'pass') {
    const holdingId = await spendCredits(db, siteId, row.email, row.seats, item.eventStartAt)
    if (!holdingId) return linkResult(item, 'no_pass')
    const status = await placeRsvp(db, siteId, item, id, 'confirmed')
    if (status !== 'confirmed') {
      await returnCredits(db, siteId, holdingId, row.seats)
      if (!status) return linkResult(item, row.status)
    }
    else {
      await markPaidByPass(db, siteId, id, holdingId, row.seats, new Date().toISOString())
    }
    await sendRsvpEmail(event, item, row, status === 'confirmed' ? 'paid' : 'waitlist').catch((err) => {
      console.error('[event-rsvp] Confirmed email failed:', err)
    })
    notifyTeam(event, item, `New booking: ${item.title}`, `${row.name} (${row.seats}) ${status === 'waitlist' ? 'joined the waitlist' : 'used a class pass'}.`)
    return linkResult(item, status)
  }

  const paid = isPaidEvent(item)
  const status = await placeRsvp(db, siteId, item, id, paid ? 'offered' : 'confirmed')
  if (!status) return linkResult(item, row.status)
  const email: RsvpEmail = status === 'offered' ? 'offer' : status
  await sendRsvpEmail(event, item, row, email).catch((err) => {
    console.error('[event-rsvp] Confirmed email failed:', err)
  })
  notifyTeam(event, item, `New RSVP: ${item.title}`, `${row.name} (${row.seats}) ${status === 'waitlist' ? 'joined the waitlist' : 'is coming'}.`)
  return linkResult(item, status, status === 'offered' ? { payUrl: await rsvpLink(event, 'pay', siteId, row.id) } : {})
}

/** What a visitor gets back if they cancel now. The organiser cancelling always gives it all back. */
export function cancellationTerms(item: RsvpSlot, row: Pick<RsvpRow, 'paymentStatus' | 'paymentMethod'>, now: Date = new Date()): CancelTerms {
  if (row.paymentStatus !== 'paid' || !row.paymentMethod) return { refund: null, tooLate: false, deadline: null }
  const start = parseStoredDate(item.eventStartAt)
  const hours = item.eventCancelHours ?? 0
  const deadline = start ? new Date(start.getTime() - hours * 3_600_000) : null
  const inTime = !deadline || now.getTime() < deadline.getTime()
  return {
    refund: inTime ? row.paymentMethod : null,
    tooLate: !inTime,
    deadline: deadline && hours > 0 ? deadline.toISOString() : null,
  }
}

function holdEnds(row: Pick<RsvpRow, 'holdExpiresAt'>): number {
  return parseStoredDate(row.holdExpiresAt)?.getTime() ?? 0
}

/** What the cancel and pay pages show before anything is pressed. Null for a bad link. */
export async function describeRsvpLink(event: H3Event, purpose: 'cancel' | 'pay', id: string, token: string): Promise<RsvpLinkDetails | null> {
  const found = await rowFromLink(event, purpose, id, token)
  if (!found) return null
  const { row, item } = found
  const offerOpen = row.status === 'offered' && holdEnds(row) > Date.now()
  return {
    ...linkResult(item, row.status),
    seats: row.seats,
    terms: cancellationTerms(item, row),
    amount: isPaidEvent(item) ? (item.eventPrice ?? 0) * row.seats : null,
    currency: item.eventCurrency || 'USD',
    canPayByCard: offerOpen && await bookingPaymentsReady(event),
    canUsePass: offerOpen && item.eventPassesAllowed !== false,
    holdExpiresAt: offerOpen ? row.holdExpiresAt : null,
  }
}

/** The buttons on the page an offer's email links to. Null for a bad link. */
export async function payForOffer(event: H3Event, id: string, token: string, method: BookingMethod): Promise<RsvpLinkResult | null> {
  const found = await rowFromLink(event, 'pay', id, token)
  if (!found) return null
  const { row, item } = found
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date()
  const nowIso = now.toISOString()
  const live = row.status === 'offered' && holdEnds(row) > now.getTime()
  // Clicked back in from a checkout they abandoned: the offer is still theirs.
  const resuming = row.status === 'held' && holdEnds(row) > now.getTime()
  if (!live && !resuming) return linkResult(item, row.status === 'confirmed' ? 'confirmed' : 'closed')
  if (rsvpIsClosed(item)) return linkResult(item, 'closed')

  if (method === 'pass') {
    if (item.eventPassesAllowed === false) validationError('This event can\'t be booked with a class pass.')
    const holdingId = await spendCredits(db, siteId, row.email, row.seats, item.eventStartAt)
    if (!holdingId) return linkResult(item, 'no_pass')
    const [claimed] = await db.update(eventRsvps)
      .set({ status: 'confirmed', confirmedAt: row.confirmedAt ?? nowIso, updatedAt: nowIso })
      .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId), inArray(eventRsvps.status, ['offered', 'held'])))
      .returning({ id: eventRsvps.id })
    if (!claimed) {
      await returnCredits(db, siteId, holdingId, row.seats)
      return linkResult(item, 'closed')
    }
    await markPaidByPass(db, siteId, id, holdingId, row.seats, nowIso)
    await sendRsvpEmail(event, item, row, 'paid').catch(err => console.error('[event-rsvp] Confirmed email failed:', err))
    notifyTeam(event, item, `New booking: ${item.title}`, `${row.name} (${row.seats}) used a class pass.`)
    return linkResult(item, 'confirmed')
  }

  if (!(await bookingPaymentsReady(event))) httpError({ status: 503, message: 'Online payments aren\'t available right now.' })
  if (resuming && row.stripeSessionId) {
    const stripe = await resolveStripeProvider(event)
    const old = await stripe?.getCheckoutSession(row.stripeSessionId).catch(() => null)
    if (old?.status === 'complete') return linkResult(item, 'confirmed')
    if (old?.status === 'open') await stripe?.expireCheckoutSession(old.id).catch(() => null)
  }
  // What's left of the offer, or long enough for the checkout if that's more.
  const offerEnd = holdEnds(row)
  await db.update(eventRsvps)
    .set({ status: 'held', holdExpiresAt: new Date(Math.max(offerEnd, now.getTime() + HOLD_MS)).toISOString(), updatedAt: nowIso })
    .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId)))
  try {
    return linkResult(item, 'checkout', { url: await openCheckout(event, item, row) })
  }
  catch (err) {
    console.error('[event-rsvp] Checkout failed:', err)
    // Back to how it was, so the offer isn't lost to a provider outage.
    await db.update(eventRsvps)
      .set({ status: 'offered', holdExpiresAt: new Date(offerEnd).toISOString(), updatedAt: nowIso })
      .where(and(eq(eventRsvps.id, id), eq(eventRsvps.siteId, siteId)))
    httpError({ status: 502, message: 'We couldn\'t reach the payment provider. Please try again in a few minutes.' })
  }
}

/** The button on the emailed cancel page. Null for an unknown row or a bad token. */
export async function cancelRsvp(event: H3Event, id: string, token: string): Promise<RsvpLinkResult | null> {
  const found = await rowFromLink(event, 'cancel', id, token)
  if (!found) return null
  const { row, item } = found
  if (row.status !== 'cancelled') {
    const { refund } = cancellationTerms(item, row)
    await setRsvpStatus(event, row, 'cancelled', { refund: Boolean(refund) })
    notifyTeam(event, item, `Booking cancelled: ${item.title}`, `${row.name} (${row.seats}) can no longer come.`)
  }
  return linkResult(item, 'cancelled')
}

// ── Giving money and credits back ───────────────────────────────────────────

/**
 * Gives back what a booking paid. Returns how, for the email's wording. Throws when Stripe
 * refuses, before anything changes, so the booking is still there to try again.
 */
async function refundBooking(event: H3Event, row: RsvpRow): Promise<RefundNote> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()

  if (row.paymentMethod === 'card' && row.paymentStatus === 'paid' && row.stripePaymentIntentId) {
    try {
      await refundPayment(event, { paymentIntentId: row.stripePaymentIntentId, idempotencyKey: `booking-refund-${row.id}-${row.stripePaymentIntentId}`, reason: 'Booking cancelled' })
    }
    catch (err) {
      console.error('[event-rsvp] Refund failed:', err)
      httpError({ status: 502, message: err instanceof Error ? `Stripe refused the refund: ${err.message}` : 'Stripe refused the refund.' })
    }
    await db.update(eventRsvps).set({ paymentStatus: 'refunded', updatedAt: now })
      .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId)))
    return 'card'
  }

  if (row.paymentMethod === 'pass' && row.creditsSpent > 0 && row.passHoldingId) {
    // The update's condition claims them, so two cancels can't give them back twice.
    const [claimed] = await db.update(eventRsvps)
      .set({ creditsSpent: 0, paymentStatus: 'refunded', updatedAt: now })
      .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId), gt(eventRsvps.creditsSpent, 0)))
      .returning({ id: eventRsvps.id })
    if (claimed) await returnCredits(db, siteId, row.passHoldingId, row.creditsSpent)
    return 'pass'
  }
  return null
}

// ── Changes by the organiser (and cancellations) ────────────────────────────

interface StatusChangeOptions {
  /** Whether a cancellation gives back what was paid. */
  refund?: boolean
  /** Whether the place freed goes to the waitlist. Not when the date itself is off. */
  promote?: boolean
}

/** Changes a booking's status, then offers any place it freed to the waitlist. */
export async function setRsvpStatus(event: H3Event, row: RsvpRow, status: 'confirmed' | 'waitlist' | 'cancelled', opts: StatusChangeOptions = {}): Promise<RefundNote> {
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  const refund = status === 'cancelled' && (opts.refund ?? true) ? await refundBooking(event, row) : null

  // Someone leaving part-way through paying: don't leave a checkout open that could still
  // take their money after they've given up the place.
  if (status === 'cancelled' && row.status === 'held' && row.stripeSessionId) {
    const stripe = await resolveStripeProvider(event)
    await stripe?.expireCheckoutSession(row.stripeSessionId).catch(() => null)
  }

  await useDb(event).update(eventRsvps)
    .set({
      status,
      updatedAt: now,
      holdExpiresAt: null,
      cancelledAt: status === 'cancelled' ? now : null,
      confirmedAt: row.confirmedAt ?? now,
    })
    .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId)))
  const hadSeats = row.status === 'confirmed' || row.status === 'held' || row.status === 'offered'
  if (hadSeats && status !== 'confirmed' && opts.promote !== false) await promoteWaitlist(event, row.contentItemId, row.occurrenceDate)
  return refund
}

/** Tells a person the organiser changed their booking. Never fails the change itself. */
export async function emailOrganiserChange(event: H3Event, item: RsvpSlot, row: RsvpRow, status: 'confirmed' | 'waitlist' | 'cancelled', refund: RefundNote = null): Promise<void> {
  const kind: RsvpEmail = status === 'cancelled' ? 'cancelled' : status === 'waitlist' ? 'waitlist' : row.status === 'waitlist' ? 'promoted' : 'confirmed'
  await sendRsvpEmail(event, item, row, kind, refund).catch((err) => {
    console.error('[event-rsvp] Organiser change email failed:', err)
  })
}

/** Adds someone by hand, e.g. a phone booking. May go over capacity; no email is sent. */
export async function addRsvpByOrganiser(event: H3Event, item: RsvpSlot, input: RsvpInput): Promise<string> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const email = normalizeEmail(input.email)
  const existing = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.contentItemId, item.id), eq(eventRsvps.occurrenceDate, item.occurrenceDate), eq(eventRsvps.email, email), eq(eventRsvps.siteId, siteId)),
    columns: { id: true, status: true },
  })
  if (existing && existing.status !== 'cancelled') conflict('That address is already on this event\'s list.')

  const now = new Date().toISOString()
  const name = input.name.trim().slice(0, 100)
  if (existing) {
    await db.update(eventRsvps)
      .set({ ...FRESH_BOOKING, name, seats: input.seats, status: 'confirmed', paymentMethod: null, startsAt: item.eventStartAt, confirmedAt: now, updatedAt: now })
      .where(and(eq(eventRsvps.id, existing.id), eq(eventRsvps.siteId, siteId)))
    return existing.id
  }
  const id = ulid()
  await db.insert(eventRsvps).values({ id, siteId, contentItemId: item.id, occurrenceDate: item.occurrenceDate, startsAt: item.eventStartAt, email, name, seats: input.seats, status: 'confirmed', confirmedAt: now })
  return id
}

/**
 * Cancels every booking on one date, with everything given back and everyone told. For a
 * repeating event the date also comes out of the series; a one-off stops taking bookings.
 * A refund Stripe refuses leaves that booking in place and is counted, so running this again
 * only has the remaining ones to do.
 */
export async function cancelEventDate(event: H3Event, series: RsvpEvent, date: string): Promise<{ cancelled: number; failed: number }> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const slot = slotOf(series, date) ?? { ...series, occurrenceDate: date }
  if (series.eventRecurrence) {
    const skip = [...new Set([...(series.eventRecurrence.skip ?? []), date])].sort()
    // The version moves too, so an editor left open is told, rather than its next autosave
    // quietly putting the cancelled date back.
    await db.update(contentItems).set({ eventRecurrence: { ...series.eventRecurrence, skip }, version: sql`${contentItems.version} + 1` })
      .where(and(eq(contentItems.id, series.id), eq(contentItems.siteId, siteId)))
  }
  else {
    await db.update(contentItems).set({ eventRsvpEnabled: false, version: sql`${contentItems.version} + 1` })
      .where(and(eq(contentItems.id, series.id), eq(contentItems.siteId, siteId)))
  }

  const rows = await db.query.eventRsvps.findMany({
    where: and(eq(eventRsvps.siteId, siteId), eq(eventRsvps.contentItemId, series.id), eq(eventRsvps.occurrenceDate, date), ne(eventRsvps.status, 'cancelled')),
    limit: MAX_BOOKINGS_PER_CHANGE,
  })
  let cancelled = 0
  let failed = 0
  for (const row of rows) {
    try {
      const refund = await setRsvpStatus(event, row, 'cancelled', { refund: true, promote: false })
      cancelled++
      // Someone who never confirmed their address has nothing to be told about.
      if (row.status !== 'pending') {
        await sendRsvpEmail(event, slot, row, 'date_cancelled', refund).catch(err => console.error('[event-rsvp] Cancellation email failed:', err))
      }
    }
    catch (err) {
      failed++
      console.error('[event-rsvp] Cancelling a booking failed:', err)
    }
  }
  return { cancelled, failed }
}

/**
 * After an event's dates or place change: each upcoming booking is moved to its date's new
 * time and told, or, if its date no longer exists, cancelled and given back what it paid.
 */
export async function reconcileBookings(event: H3Event, itemId: string, opts: { timesChanged: boolean; placeChanged: boolean }): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const series = await getRsvpEvent(db, siteId, itemId)
  if (!series) return
  const now = new Date().toISOString()
  const rows = await db.query.eventRsvps.findMany({
    where: and(
      eq(eventRsvps.siteId, siteId),
      eq(eventRsvps.contentItemId, itemId),
      notInArray(eventRsvps.status, ['cancelled']),
      gte(eventRsvps.startsAt, now),
    ),
    limit: MAX_BOOKINGS_PER_CHANGE,
  })
  let failed = 0
  for (const row of rows) {
    // A one-off that became a series keeps its bookings on the first date. A series that
    // became a one-off has lost every date but that one.
    const firstDay = eventDay(series.eventStartAt, series.eventAllDay, series.timeZone)
    const date = series.eventRecurrence ? row.occurrenceDate || firstDay : row.occurrenceDate
    const slot = !series.eventRecurrence && row.occurrenceDate && row.occurrenceDate !== firstDay ? null : slotOf(series, date)
    if (slot && slot.occurrenceDate !== row.occurrenceDate) {
      await db.update(eventRsvps).set({ occurrenceDate: slot.occurrenceDate, updatedAt: now })
        .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId)))
    }
    if (!slot?.eventStartAt) {
      const past = { ...series, occurrenceDate: row.occurrenceDate, eventStartAt: row.startsAt, eventEndAt: null }
      try {
        const refund = await setRsvpStatus(event, row, 'cancelled', { refund: true, promote: false })
        if (row.status !== 'pending') await sendRsvpEmail(event, past, row, 'date_cancelled', refund)
      }
      catch (err) {
        failed++
        console.error('[event-rsvp] Cancelling a removed date failed:', err)
      }
      continue
    }
    const moved = opts.timesChanged && slot.eventStartAt !== row.startsAt
    if (moved) {
      // The reminder goes out again if the new time is further away.
      await db.update(eventRsvps).set({ startsAt: slot.eventStartAt, reminderSentAt: null, updatedAt: now })
        .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId)))
    }
    if ((moved || opts.placeChanged) && (row.status === 'confirmed' || row.status === 'waitlist' || row.status === 'offered')) {
      await sendRsvpEmail(event, slot, row, 'changed').catch(err => console.error('[event-rsvp] Change email failed:', err))
    }
  }
  if (failed) {
    notifyTeam(event, series, `Couldn't refund everyone: ${series.title}`, `${failed} ${failed === 1 ? 'booking' : 'bookings'} on a removed date couldn't be refunded. Open the attendee list to try again.`)
  }
}

/** Whether deleting an event would lose track of what people paid for upcoming dates. */
export async function hasPaidUpcomingBookings(db: Db, siteId: string, itemId: string): Promise<boolean> {
  const row = await db.query.eventRsvps.findFirst({
    where: and(
      eq(eventRsvps.siteId, siteId),
      eq(eventRsvps.contentItemId, itemId),
      eq(eventRsvps.status, 'confirmed'),
      eq(eventRsvps.paymentStatus, 'paid'),
      gte(eventRsvps.startsAt, new Date().toISOString()),
    ),
    columns: { id: true },
  })
  return Boolean(row)
}

// ── After Stripe ────────────────────────────────────────────────────────────

/** The payment for a held booking arrived. Safe to run twice for the same payment. */
export async function settleBookingPayment(event: H3Event, payment: { rsvpId: string; sessionId: string; paymentIntentId: string | null; amount: number; currency: string }): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  const paidFields = {
    status: 'confirmed',
    paymentMethod: 'card',
    paymentStatus: 'paid',
    amountPaid: payment.amount,
    currency: payment.currency.toUpperCase(),
    stripePaymentIntentId: payment.paymentIntentId,
    holdExpiresAt: null,
    updatedAt: now,
  } as const
  const [settled] = await db.update(eventRsvps)
    .set({ ...paidFields, confirmedAt: now })
    .where(and(
      eq(eventRsvps.id, payment.rsvpId),
      eq(eventRsvps.siteId, siteId),
      eq(eventRsvps.status, 'held'),
      eq(eventRsvps.stripeSessionId, payment.sessionId),
    ))
    .returning()

  const row = settled ?? await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.id, payment.rsvpId), eq(eventRsvps.siteId, siteId)),
  })
  const series = row ? await getRsvpEvent(db, siteId, row.contentItemId) : null
  const slot = row && series ? slotForRow(series, row) : null

  if (settled && slot) {
    await sendRsvpEmail(event, slot, settled, 'paid').catch(err => console.error('[event-rsvp] Booked email failed:', err))
    notifyTeam(event, slot, `New booking: ${slot.title}`, `${settled.name} (${settled.seats}) has paid.`)
    return
  }
  // A redelivery of a payment already taken.
  if (row?.paymentStatus === 'paid' && row.stripePaymentIntentId === payment.paymentIntentId) return

  // Paid, but the hold had lapsed. If this is still their latest attempt and the seats are
  // free, they get the place. Otherwise they get their money straight back.
  if (row && slot && row.stripeSessionId === payment.sessionId && row.status === 'cancelled') {
    const [regained] = await db.update(eventRsvps)
      .set({ ...paidFields, confirmedAt: now, cancelledAt: null })
      .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId), eq(eventRsvps.status, 'cancelled'), hasRoom(slot, now)))
      .returning()
    if (regained) {
      await sendRsvpEmail(event, slot, regained, 'paid').catch(err => console.error('[event-rsvp] Booked email failed:', err))
      return
    }
  }
  if (payment.paymentIntentId) {
    await refundPayment(event, { paymentIntentId: payment.paymentIntentId, idempotencyKey: `booking-refund-${payment.rsvpId}-${payment.paymentIntentId}`, reason: 'Paid after the place had gone' })
  }
  if (row && slot) {
    await sendRsvpEmail(event, slot, row, 'no_place_refunded').catch(err => console.error('[event-rsvp] Refund email failed:', err))
    notifyTeam(event, slot, `Payment refunded: ${slot.title}`, `${row.name} paid after their place had gone, so they were refunded.`)
  }
}

/** A checkout closed unpaid. Only the attempt it belongs to loses its hold. */
export async function releaseExpiredCheckout(event: H3Event, rsvpId: string, sessionId: string): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  const [released] = await db.update(eventRsvps)
    .set({ status: 'cancelled', cancelledAt: now, holdExpiresAt: null, updatedAt: now })
    .where(and(eq(eventRsvps.id, rsvpId), eq(eventRsvps.siteId, siteId), eq(eventRsvps.status, 'held'), eq(eventRsvps.stripeSessionId, sessionId)))
    .returning({ contentItemId: eventRsvps.contentItemId, occurrenceDate: eventRsvps.occurrenceDate })
  if (released) await promoteWaitlist(event, released.contentItemId, released.occurrenceDate)
}

/** A payment refunded from Stripe's own dashboard: the booking follows it. */
export async function applyStripeRefundToBookings(event: H3Event, paymentIntentId: string): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const row = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.siteId, siteId), eq(eventRsvps.stripePaymentIntentId, paymentIntentId), eq(eventRsvps.paymentStatus, 'paid')),
  })
  if (!row) return
  await db.update(eventRsvps).set({ paymentStatus: 'refunded', updatedAt: new Date().toISOString() })
    .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId)))
  if (row.status === 'cancelled') return
  // The refund has already happened, so there's nothing left for this to give back.
  await setRsvpStatus(event, row, 'cancelled', { refund: false })
  const series = await getRsvpEvent(db, siteId, row.contentItemId)
  if (series) await sendRsvpEmail(event, slotForRow(series, row), row, 'cancelled', 'card').catch(err => console.error('[event-rsvp] Refund email failed:', err))
}

// ── The hourly sweep ────────────────────────────────────────────────────────

/** A hold or offer whose time is up, on the site the event is for. */
export async function expireHold(event: H3Event, row: RsvpRow): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  const [expired] = await db.update(eventRsvps)
    .set({ status: 'cancelled', cancelledAt: now, holdExpiresAt: null, updatedAt: now })
    .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId), inArray(eventRsvps.status, ['held', 'offered']), lt(eventRsvps.holdExpiresAt, now)))
    .returning({ id: eventRsvps.id })
  if (!expired) return
  if (row.status === 'offered') {
    const series = await getRsvpEvent(db, siteId, row.contentItemId)
    if (series) await sendRsvpEmail(event, slotForRow(series, row), row, 'offer_expired').catch(err => console.error('[event-rsvp] Offer email failed:', err))
  }
  await promoteWaitlist(event, row.contentItemId, row.occurrenceDate)
}

/** The day-before reminder. Claimed first, so two runs can't send it twice. */
export async function sendBookingReminder(event: H3Event, row: RsvpRow): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  const [claimed] = await db.update(eventRsvps)
    .set({ reminderSentAt: now })
    .where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId), eq(eventRsvps.status, 'confirmed'), sql`${eventRsvps.reminderSentAt} is null`))
    .returning({ id: eventRsvps.id })
  if (!claimed) return
  const series = await getRsvpEvent(db, siteId, row.contentItemId)
  if (series) await sendRsvpEmail(event, slotForRow(series, row), row, 'reminder')
}

// ── A visitor's own list ────────────────────────────────────────────────────

/** What's on someone's list, for /booking/my. Only reached through a signed link. */
export async function listBookingsFor(event: H3Event, email: string): Promise<MyBookings> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const address = normalizeEmail(email)
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const [rows, holdings, appointments] = await Promise.all([
    db.query.eventRsvps.findMany({
      where: and(
        eq(eventRsvps.siteId, siteId),
        eq(eventRsvps.email, address),
        inArray(eventRsvps.status, ['confirmed', 'waitlist', 'offered', 'held']),
        gte(eventRsvps.startsAt, since),
      ),
      orderBy: [asc(eventRsvps.startsAt)],
      limit: 100,
    }),
    db.query.classPassHoldings.findMany({
      where: and(eq(classPassHoldings.siteId, siteId), eq(classPassHoldings.email, address)),
      orderBy: [desc(classPassHoldings.createdAt)],
      limit: 50,
    }),
    listAppointmentsFor(event, address),
  ])

  const seriesById = new Map<string, RsvpEvent | null>()
  const bookings = []
  for (const row of rows) {
    if (!seriesById.has(row.contentItemId)) seriesById.set(row.contentItemId, await getRsvpEvent(db, siteId, row.contentItemId))
    const series = seriesById.get(row.contentItemId)
    if (!series) continue
    const slot = slotForRow(series, row)
    bookings.push({
      id: row.id,
      seats: row.seats,
      status: row.status,
      title: slot.title,
      when: formatEventWhen(eventTimes(slot), slot.timeZone, slot.locale),
      location: slot.eventLocation,
      cancelUrl: await rsvpLink(event, 'cancel', siteId, row.id),
      payUrl: row.status === 'offered' ? await rsvpLink(event, 'pay', siteId, row.id) : null,
    })
  }
  return {
    bookings,
    appointments,
    passes: holdings.map(h => ({
      id: h.id,
      name: h.passName,
      creditsLeft: h.status === 'active' ? creditsLeft(h) : 0,
      creditsTotal: h.creditsTotal,
      expiresAt: h.expiresAt,
      status: h.status,
    })),
  }
}

/** Sends someone a link to their list, if they have anything on it. */
export async function sendBookingAccessEmail(event: H3Event, email: string): Promise<void> {
  const { bookings, passes, appointments } = await listBookingsFor(event, email)
  if (bookings.length === 0 && passes.length === 0 && appointments.length === 0) return
  await sendTemplatedEmail(event, {
    to: normalizeEmail(email),
    subject: 'Your bookings and passes',
    category: 'event_rsvp',
    template: {
      heading: 'Your bookings and passes',
      paragraphs: ['Here\'s the link you asked for. It works for 7 days.'],
      action: { label: 'See my bookings and passes', url: await bookingAccessLink(event, email) },
      footnote: 'If you didn\'t ask for this, you can ignore this email.',
    },
  })
}
