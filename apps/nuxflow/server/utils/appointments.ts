import type { H3Event } from 'h3'
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { ulid } from 'ulid'
import { appointments, contentItems, sites } from '@nuxflow/db/schema'
import { addDays, formatEventWhen, todayIn, utcToZoned, zonedToUtc } from '@nuxflow/canvas/events'
import { slotsOn, type BusinessInfo } from '@nuxflow/canvas/business'
import { useDb, type Db } from './db'
import { resolveSetting } from './settings'
import { getBusinessInfo } from './business'
import { findPublishedPage, parseLocalePath } from './public-page'
import { checkContentAccess } from './content-access'
import { loadEmailConfig } from './email'
import { sendTemplatedEmail } from './email-template'
import { normalizeEmail } from './mailing-list'
import { notifySiteRole } from './notify'
import { publicPathForItem } from './seo'
import { requireSiteId } from './site-context'
import { waitUntil } from './cf-env'
import { hmacSha256Hex, constantTimeEqualHex } from './webhook-crypto'
import { getStripeProvider } from './payments/resolve'
import { bookingOrigin, bookingPaymentsReady } from './class-passes'
import { refundPayment, withPendingOrder } from './orders'
import { httpError, notFound, validationError } from './response'
import { toMinorUnits } from '../../shared/lib/money'
import {
  WEEKDAYS,
  formatDuration,
  freeTimes,
  isDayOff,
  parseAppointmentSettings,
  parseService,
  weekdayOf,
  type AppointmentService,
  type AppointmentSettings,
  type Busy,
  type TimeRange,
} from '../../shared/lib/appointments'
import type { AdminAppointmentList, AppointmentFreeTimes, AppointmentLinkResult, BookingAnswer, PublicService } from '../../shared/lib/booking-types'

export type { AppointmentLinkResult, BookingAnswer, PublicService }

/**
 * One-to-one appointments: a visitor picks a free time from an Appointment block and books
 * it. One diary per site — nothing live overlaps, including each appointment's gap after it.
 *
 * Free: the slot is kept while the visitor confirms by the emailed link (`pending`), so a
 * made-up address can't fill the diary for long. With no email provider the booking is
 * confirmed at once. Paid (Stripe, card only): the slot is kept while they're at Stripe
 * (`held`) and the webhook confirms it; a payment that lands after the slot has gone is
 * refunded. Cancelling follows the service's refund rule; the organiser cancelling always
 * refunds. A slot is taken by inserting a `draft` row and then one conditional UPDATE that
 * only succeeds if nothing live overlaps, so two people can't get the same time.
 *
 * The service is the block's props on the published page, read again at booking — a visitor
 * can't send their own price — and copied onto the row.
 */

export const APPOINTMENT_SETTINGS_KEY = 'appointments.settings'
export const APPOINTMENT_BLOCK = 'canvas-appointment'

/** How long a free booking keeps its slot while waiting for the emailed link. */
const CONFIRM_HOLD_MS = 60 * 60_000
/** How long a visitor has at Stripe (its minimum is 30 minutes). */
const CHECKOUT_MINUTES = 31
const CHECKOUT_HOLD_MS = (CHECKOUT_MINUTES + 5) * 60_000
/** Days of free times the block gets per request. */
const DAYS_PER_PAGE = 14
/** Reminders go out this long before an appointment. */
const REMINDER_MS = 24 * 3_600_000

export type AppointmentRow = typeof appointments.$inferSelect
type LinkPurpose = 'confirm' | 'cancel' | 'ics'

// ── Settings ────────────────────────────────────────────────────────────────

export async function getAppointmentSettings(event: H3Event): Promise<AppointmentSettings> {
  return parseAppointmentSettings(await resolveSetting(event, APPOINTMENT_SETTINGS_KEY))
}

/** Checks an `appointments.settings` value sent to the settings PATCH. Throws a 422. */
export function normalizeAppointmentSetting(value: unknown): AppointmentSettings {
  if (!value || typeof value !== 'object') throw validationError('Appointments: these settings aren\'t valid')
  const raw = value as { hours?: Record<string, unknown>; daysOff?: unknown }
  const parsed = parseAppointmentSettings(value)
  for (const d of WEEKDAYS) {
    const sent = Array.isArray(raw.hours?.[d]) ? (raw.hours![d] as unknown[]).length : 0
    if (sent !== parsed.hours[d].length) throw validationError('Appointments: some hours aren\'t valid times (use HH:MM).')
  }
  const sentDays = Array.isArray(raw.daysOff) ? raw.daysOff.length : 0
  if (sentDays !== parsed.daysOff.length) throw validationError('Appointments: some days off aren\'t valid dates.')
  return parsed
}

/** The working hours on one date (site wall clock). */
export function hoursFor(settings: AppointmentSettings, business: BusinessInfo | null, date: string): TimeRange[] {
  if (isDayOff(settings, date)) return []
  if (settings.useOpeningHours) return business ? slotsOn(business, date).slots : []
  return settings.hours[weekdayOf(date)]
}

// ── Links ───────────────────────────────────────────────────────────────────

function linkSecret(): string {
  const secret = useRuntimeConfig().betterAuthSecret as string | undefined
  if (!secret) throw new Error('betterAuthSecret is not configured')
  return secret
}

export function appointmentToken(purpose: LinkPurpose, siteId: string, id: string): Promise<string> {
  return hmacSha256Hex(linkSecret(), `appointment:${purpose}:${siteId}:${id}`)
}

export async function verifyAppointmentToken(purpose: LinkPurpose, siteId: string, id: string, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false
  return constantTimeEqualHex(await appointmentToken(purpose, siteId, id), token)
}

async function appointmentLink(event: H3Event, purpose: 'confirm' | 'cancel', siteId: string, id: string): Promise<string> {
  const params = new URLSearchParams({ do: purpose, id, token: await appointmentToken(purpose, siteId, id) })
  return `${bookingOrigin(event)}/appointment?${params}`
}

export async function appointmentIcsLink(event: H3Event, siteId: string, id: string): Promise<string> {
  return `${bookingOrigin(event)}/_nuxflow/appointment-ics/${id}?token=${await appointmentToken('ics', siteId, id)}`
}

// ── The service on a page ───────────────────────────────────────────────────

interface CanvasBlockLike { id?: string; type?: string; props?: Record<string, unknown>; children?: Record<string, unknown> }

/** An Appointment block by id, anywhere in a page's blocks (columns included). */
export function findAppointmentBlock(content: unknown, blockId: string): CanvasBlockLike | null {
  const walk = (list: unknown): CanvasBlockLike | null => {
    if (!Array.isArray(list)) return null
    for (const b of list as CanvasBlockLike[]) {
      if (!b || typeof b !== 'object') continue
      if (b.id === blockId && b.type === APPOINTMENT_BLOCK) return b
      for (const kids of Object.values(b.children ?? {})) {
        const found = walk(kids)
        if (found) return found
      }
    }
    return null
  }
  return walk((content as { blocks?: unknown } | null)?.blocks)
}

export interface ServiceContext {
  siteId: string
  page: { id: string; slug: string; title: string; sourceItemId: string | null }
  blockId: string
  service: AppointmentService
  timeZone: string
  locale: string
}

/**
 * The service an Appointment block offers on the published page at `path`, when the visitor
 * may see that page. 404 otherwise, so a gated page isn't confirmed.
 */
export async function resolveService(event: H3Event, path: string, blockId: string): Promise<ServiceContext> {
  const siteId = requireSiteId(event)
  const db = useDb(event)
  const slugPath = path.replace(/^\/+|\/+$/g, '') || 'home'
  const { locale, slug } = await parseLocalePath(db, siteId, slugPath)
  const page = await findPublishedPage(db, siteId, slug || 'home', locale)
  if (!page) throw notFound()
  const gate = await checkContentAccess(event, { id: page.id, sourceItemId: page.sourceItemId, visibility: page.visibility, settings: page.settings as Record<string, unknown> | null }, siteId)
  if (gate?.blocked) throw notFound()
  const block = findAppointmentBlock(page.content, blockId)
  if (!block) throw notFound()
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { timezone: true, locale: true } })
  return {
    siteId,
    page: { id: page.id, slug: page.slug, title: page.title, sourceItemId: page.sourceItemId },
    blockId,
    service: parseService(block.props, page.title),
    timeZone: site?.timezone || 'UTC',
    locale: page.locale || site?.locale || 'en',
  }
}

// ── The diary ───────────────────────────────────────────────────────────────

/** Rows that take up time: booked, or kept for someone whose time isn't up. */
function isLive(now: string): SQL {
  return sql`(${appointments.status} = 'confirmed' or (${appointments.status} in ('pending', 'held') and ${appointments.holdExpiresAt} > ${now}))`
}

async function busyBetween(db: Db, siteId: string, from: string, to: string, now: string): Promise<Busy[]> {
  const rows = await db.select({ start: appointments.startsAt, end: appointments.blockedUntil }).from(appointments).where(and(
    eq(appointments.siteId, siteId),
    lt(appointments.startsAt, to),
    gt(appointments.blockedUntil, from),
    isLive(now),
  ))
  return rows
}

/** What the block shows: the service and the free times for DAYS_PER_PAGE days from `from`. */
export async function listFreeTimes(event: H3Event, ctx: ServiceContext, from?: string): Promise<AppointmentFreeTimes> {
  const db = useDb(event)
  const now = new Date()
  const nowIso = now.toISOString()
  const today = todayIn(ctx.timeZone, now)
  const last = addDays(today, ctx.service.daysAhead)
  const first = from && /^\d{4}-\d{2}-\d{2}$/.test(from) && from > today ? (from > last ? last : from) : today
  const end = addDays(first, DAYS_PER_PAGE - 1) > last ? last : addDays(first, DAYS_PER_PAGE - 1)

  const [settings, business] = await Promise.all([getAppointmentSettings(event), getBusinessInfo(event)])
  const windowStart = zonedToUtc(`${first}T00:00`, ctx.timeZone) ?? nowIso
  const windowEnd = zonedToUtc(`${addDays(end, 1)}T00:00`, ctx.timeZone) ?? nowIso
  const busy = await busyBetween(db, ctx.siteId, windowStart, windowEnd, nowIso)

  const days: Array<{ date: string; times: Array<{ start: string; time: string }> }> = []
  for (let d = first; d <= end; d = addDays(d, 1)) {
    const times = freeTimes({ date: d, hours: hoursFor(settings, business, d), service: ctx.service, busy, now, toUtc: w => zonedToUtc(w, ctx.timeZone) })
    days.push({ date: d, times: times.map(t => ({ start: t.start, time: t.time })) })
  }
  const service: PublicService = {
    name: ctx.service.name,
    duration: ctx.service.duration,
    durationText: formatDuration(ctx.service.duration),
    price: ctx.service.price,
    currency: ctx.service.currency,
    cancelHours: ctx.service.cancelHours,
    canPayByCard: ctx.service.price ? await bookingPaymentsReady(event) : false,
  }
  return {
    service,
    timeZone: ctx.timeZone,
    days,
    previous: first > today ? (addDays(first, -DAYS_PER_PAGE) < today ? today : addDays(first, -DAYS_PER_PAGE)) : null,
    next: end < last ? addDays(end, 1) : null,
  }
}

function whenText(row: Pick<AppointmentRow, 'startsAt' | 'endsAt'>, timeZone: string, locale: string): string {
  return formatEventWhen({ eventStartAt: row.startsAt, eventEndAt: row.endsAt, eventAllDay: false }, timeZone, locale)
}

/** Takes the slot for a draft row (or a pending/held one whose time may have run out). */
async function claim(db: Db, siteId: string, id: string, from: AppointmentRow['status'][], to: 'pending' | 'held' | 'confirmed', holdMs: number | null): Promise<boolean> {
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const other = sql`exists (
    select 1 from appointments taken
    where taken.site_id = ${siteId}
      and taken.id <> appointments.id
      and taken.starts_at < appointments.blocked_until
      and taken.blocked_until > appointments.starts_at
      and (taken.status = 'confirmed' or (taken.status in ('pending', 'held') and taken.hold_expires_at > ${now}))
  )`
  const [row] = await db.update(appointments)
    .set({
      status: to,
      holdExpiresAt: holdMs ? new Date(nowDate.getTime() + holdMs).toISOString() : null,
      ...(to === 'confirmed' ? { confirmedAt: now } : {}),
      updatedAt: now,
    })
    .where(and(eq(appointments.id, id), eq(appointments.siteId, siteId), inArray(appointments.status, from), sql`not ${other}`))
    .returning({ id: appointments.id })
  return Boolean(row)
}

async function canEmail(event: H3Event): Promise<boolean> {
  const { emailProvider } = await loadEmailConfig(event)
  return Boolean(emailProvider) && emailProvider !== 'console'
}

function notifyTeam(event: H3Event, title: string, body: string): void {
  waitUntil(event, notifySiteRole(event, {
    siteId: requireSiteId(event),
    minRole: 'editor',
    type: 'appointment.booked',
    title,
    body,
    pushUrl: '/admin/appointments',
  }).catch((err) => {
    console.error('[appointments] Team notification failed:', err)
  }))
}

export interface BookingInput {
  start: string
  name: string
  email: string
  phone?: string
  note?: string
}

/** Books a time. The start must be one the block offers; the slot is taken atomically. */
export async function bookAppointment(event: H3Event, ctx: ServiceContext, input: BookingInput): Promise<BookingAnswer> {
  const db = useDb(event)
  const { siteId, service } = ctx
  const now = new Date()
  const startDate = new Date(input.start)
  if (Number.isNaN(startDate.getTime())) validationError('Please choose a time.')
  const startIso = startDate.toISOString()
  const date = utcToZoned(startIso, ctx.timeZone).slice(0, 10)
  const today = todayIn(ctx.timeZone, now)
  if (date < today || date > addDays(today, service.daysAhead)) validationError('That time can\'t be booked.')

  // The time must be one the hours and notice allow; whether it's free is decided below.
  const [settings, business] = await Promise.all([getAppointmentSettings(event), getBusinessInfo(event)])
  const offered = freeTimes({ date, hours: hoursFor(settings, business, date), service, busy: [], now, toUtc: w => zonedToUtc(w, ctx.timeZone) })
  const slot = offered.find(t => t.start === startIso)
  if (!slot) validationError('That time can\'t be booked. Please choose another.')

  const paid = Boolean(service.price)
  if (paid && !(await bookingPaymentsReady(event))) httpError({ status: 503, message: 'Online payments aren\'t available right now.' })
  const withEmail = await canEmail(event)

  const id = ulid()
  const email = normalizeEmail(input.email)
  const name = input.name.trim().slice(0, 100)
  const blockedUntil = new Date(Date.parse(slot!.end) + service.buffer * 60_000).toISOString()
  await db.insert(appointments).values({
    id,
    siteId,
    contentItemId: ctx.page.sourceItemId ?? ctx.page.id,
    blockId: ctx.blockId,
    serviceName: service.name,
    startsAt: slot!.start,
    endsAt: slot!.end,
    blockedUntil,
    email,
    name,
    phone: (input.phone ?? '').trim().slice(0, 40),
    note: (input.note ?? '').trim().slice(0, 1000),
    status: 'draft',
    price: service.price,
    currency: paid ? service.currency : null,
    cancelHours: service.cancelHours,
  })

  const target = paid ? 'held' : withEmail ? 'pending' : 'confirmed'
  const holdMs = paid ? CHECKOUT_HOLD_MS : withEmail ? CONFIRM_HOLD_MS : null
  if (!(await claim(db, siteId, id, ['draft'], target, holdMs))) {
    await db.delete(appointments).where(and(eq(appointments.id, id), eq(appointments.siteId, siteId)))
    httpError({ status: 409, message: 'Sorry, that time has just been taken. Please choose another.' })
  }
  const row = (await db.query.appointments.findFirst({ where: and(eq(appointments.id, id), eq(appointments.siteId, siteId)) }))!
  const when = whenText(row, ctx.timeZone, ctx.locale)

  if (paid) {
    try {
      return { status: 'checkout', id, url: await openCheckout(event, ctx, row, when) }
    }
    catch (err) {
      console.error('[appointments] Checkout failed:', err)
      await cancelRow(db, siteId, id)
      httpError({ status: 502, message: 'We couldn\'t reach the payment provider. Please try again in a few minutes.' })
    }
  }

  if (!withEmail) {
    notifyTeam(event, `New appointment: ${service.name}`, `${name}, ${when}.`)
    return { status: 'confirmed', id }
  }

  try {
    await sendAppointmentEmail(event, row, 'confirm', { timeZone: ctx.timeZone, locale: ctx.locale, slug: ctx.page.slug })
  }
  catch (err) {
    console.error('[appointments] Confirmation email failed:', err)
    await cancelRow(db, siteId, id)
    httpError({ status: 502, message: 'We couldn\'t send your confirmation email. Please try again in a few minutes.' })
  }
  await db.update(appointments).set({ confirmSentAt: now.toISOString() }).where(and(eq(appointments.id, id), eq(appointments.siteId, siteId)))
  return { status: 'pending', id }
}

async function cancelRow(db: Db, siteId: string, id: string): Promise<void> {
  const now = new Date().toISOString()
  await db.update(appointments)
    .set({ status: 'cancelled', cancelledAt: now, holdExpiresAt: null, updatedAt: now })
    .where(and(eq(appointments.id, id), eq(appointments.siteId, siteId)))
}

async function openCheckout(event: H3Event, ctx: ServiceContext, row: AppointmentRow, when: string): Promise<string> {
  const stripe = await getStripeProvider(event)
  const origin = bookingOrigin(event)
  const currency = row.currency || 'GBP'
  const order = {
    email: row.email,
    name: row.name,
    currency,
    lines: [{ kind: 'appointment' as const, refId: row.contentItemId, recordId: row.id, name: row.serviceName, description: when, quantity: 1, unitMinor: toMinorUnits(row.price ?? 0, currency) }],
  }
  const session = await withPendingOrder(event, order, ({ id: orderId }) => stripe.createPaymentCheckout({
    customerEmail: row.email,
    item: { name: row.serviceName, description: when, amount: row.price ?? 0, currency, quantity: 1 },
    successUrl: `${origin}/booking/thanks?type=appointment`,
    cancelUrl: `${origin}${publicPathForItem({ slug: ctx.page.slug }, ctx.locale)}`,
    metadata: { nuxflowKind: 'appointment', siteId: ctx.siteId, appointmentId: row.id, orderId },
    expiresInMinutes: CHECKOUT_MINUTES,
  }))
  await useDb(event).update(appointments)
    .set({ stripeSessionId: session.id, updatedAt: new Date().toISOString() })
    .where(and(eq(appointments.id, row.id), eq(appointments.siteId, ctx.siteId)))
  if (!session.url) throw new Error('Stripe returned no checkout address')
  return session.url
}

// ── Emails ──────────────────────────────────────────────────────────────────

type AppointmentEmail = 'confirm' | 'booked' | 'cancelled' | 'cancelled_by_you' | 'reminder' | 'no_slot_refunded'

interface EmailPlace { timeZone: string; locale: string; slug: string }

async function placeFor(event: H3Event, row: AppointmentRow): Promise<EmailPlace> {
  const db = useDb(event)
  const [site, item] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, row.siteId), columns: { timezone: true, locale: true } }),
    db.query.contentItems.findFirst({ where: and(eq(contentItems.id, row.contentItemId), eq(contentItems.siteId, row.siteId)), columns: { slug: true, locale: true } }),
  ])
  return { timeZone: site?.timezone || 'UTC', locale: item?.locale || site?.locale || 'en', slug: item?.slug ?? '' }
}

async function sendAppointmentEmail(event: H3Event, row: AppointmentRow, kind: AppointmentEmail, place?: EmailPlace, refunded = false): Promise<void> {
  const where = place ?? await placeFor(event, row)
  const siteId = row.siteId
  const when = whenText(row, where.timeZone, where.locale)
  const origin = bookingOrigin(event)
  const pageUrl = where.slug ? `${origin}${publicPathForItem({ slug: where.slug }, where.locale)}` : origin
  const view = { label: 'View the details', url: pageUrl }
  const booked = kind === 'booked' || kind === 'reminder'
  const cancelUrl = booked ? await appointmentLink(event, 'cancel', siteId, row.id) : ''
  const icsUrl = booked ? await appointmentIcsLink(event, siteId, row.id) : ''
  const policy = row.paymentStatus === 'paid'
    ? row.cancelHours ? ` Cancel at least ${row.cancelHours % 24 === 0 ? `${row.cancelHours / 24} ${row.cancelHours === 24 ? 'day' : 'days'}` : `${row.cancelHours} hours`} before for a refund.` : ' Cancel any time before it starts for a refund.'
    : ''
  const refundLine = refunded ? ' Your payment has been refunded; it can take a few days to reach your account.' : ''

  const emails: Record<AppointmentEmail, { subject: string; heading: string; body: string; action: { label: string; url: string }; footnote?: string }> = {
    confirm: {
      subject: `Confirm your appointment: ${row.serviceName}`,
      heading: 'Please confirm your appointment',
      body: `Someone (hopefully you) asked to book ${row.serviceName}. One more click and it's done. We're keeping the time for you for the next hour.`,
      action: { label: 'Yes, confirm my appointment', url: await appointmentLink(event, 'confirm', siteId, row.id) },
      footnote: 'If you didn\'t ask for this, ignore this email and nothing will happen.',
    },
    booked: {
      subject: `Booked: ${row.serviceName}`,
      heading: 'You\'re booked',
      body: `Your appointment for ${row.serviceName} is booked.`,
      action: { label: 'Add to my calendar', url: icsUrl },
      footnote: `Can't make it? Cancel here:${policy} ${cancelUrl}`,
    },
    reminder: {
      subject: `Reminder: ${row.serviceName}`,
      heading: 'See you soon',
      body: `This is a reminder of your appointment for ${row.serviceName}.`,
      action: { label: 'Add to my calendar', url: icsUrl },
      footnote: `Can't make it? Cancel here:${policy} ${cancelUrl}`,
    },
    cancelled: {
      subject: `Cancelled: ${row.serviceName}`,
      heading: 'Your appointment was cancelled',
      body: `We're sorry, your appointment for ${row.serviceName} has been cancelled.${refundLine} Please get in touch if you'd like to book another time.`,
      action: view,
    },
    cancelled_by_you: {
      subject: `Cancelled: ${row.serviceName}`,
      heading: 'Your appointment is cancelled',
      body: `As you asked, your appointment for ${row.serviceName} has been cancelled.${refundLine}`,
      action: view,
    },
    no_slot_refunded: {
      subject: `We've refunded you: ${row.serviceName}`,
      heading: 'We couldn\'t keep that time',
      body: `We received your payment for ${row.serviceName}, but the time was no longer free, so we've refunded you in full. It can take a few days to reach your account. Please book another time.`,
      action: view,
    },
  }
  const email = emails[kind]
  await sendTemplatedEmail(event, {
    to: row.email,
    subject: email.subject,
    category: 'appointment',
    template: { preheader: when, heading: email.heading, paragraphs: [email.body, when], action: email.action, footnote: email.footnote },
  })
}

// ── Links from emails ───────────────────────────────────────────────────────

async function rowFromLink(event: H3Event, purpose: LinkPurpose, id: string, token: string): Promise<AppointmentRow | null> {
  const siteId = requireSiteId(event)
  if (!(await verifyAppointmentToken(purpose, siteId, id, token))) return null
  return (await useDb(event).query.appointments.findFirst({ where: and(eq(appointments.id, id), eq(appointments.siteId, siteId)) })) ?? null
}

/** What a visitor cancelling now would get back. The organiser cancelling always refunds. */
export function appointmentCancelTerms(row: Pick<AppointmentRow, 'paymentStatus' | 'startsAt' | 'cancelHours'>, now: Date = new Date()): { refund: boolean; tooLate: boolean } {
  if (row.paymentStatus !== 'paid') return { refund: false, tooLate: false }
  const deadline = Date.parse(row.startsAt) - row.cancelHours * 3_600_000
  const inTime = now.getTime() < deadline
  return { refund: inTime, tooLate: !inTime }
}

async function result(event: H3Event, row: AppointmentRow, status: AppointmentLinkResult['status'], extra: Partial<AppointmentLinkResult> = {}): Promise<AppointmentLinkResult> {
  const place = await placeFor(event, row)
  return {
    status,
    service: row.serviceName,
    when: whenText(row, place.timeZone, place.locale),
    path: place.slug ? publicPathForItem({ slug: place.slug }, place.locale) : '/',
    ...extra,
  }
}

/** What the cancel page shows before the button is pressed. Null for a bad link. */
export async function describeAppointmentLink(event: H3Event, purpose: 'confirm' | 'cancel', id: string, token: string) {
  const row = await rowFromLink(event, purpose, id, token)
  if (!row) return null
  const terms = appointmentCancelTerms(row)
  return result(event, row, row.status, purpose === 'cancel' ? terms : {})
}

/** The button on the emailed confirm page. Null for a bad link. */
export async function confirmAppointment(event: H3Event, id: string, token: string): Promise<AppointmentLinkResult | null> {
  const row = await rowFromLink(event, 'confirm', id, token)
  if (!row) return null
  // A second click is fine, and an old link must not undo a cancellation.
  if (row.status !== 'pending') return result(event, row, row.status)
  if (Date.parse(row.startsAt) <= Date.now()) return result(event, row, 'taken')
  const db = useDb(event)
  // Even past its hour the time is theirs if nobody else has taken it since.
  if (!(await claim(db, row.siteId, row.id, ['pending'], 'confirmed', null))) {
    await cancelRow(db, row.siteId, row.id)
    return result(event, row, 'taken')
  }
  const fresh = { ...row, status: 'confirmed' as const }
  const place = await placeFor(event, fresh)
  await sendAppointmentEmail(event, fresh, 'booked', place).catch(err => console.error('[appointments] Booked email failed:', err))
  notifyTeam(event, `New appointment: ${row.serviceName}`, `${row.name}, ${whenText(row, place.timeZone, place.locale)}.`)
  return result(event, fresh, 'confirmed')
}

/** The visitor's own cancel. Refunds when the service's rule allows. Null for a bad link. */
export async function cancelAppointmentByLink(event: H3Event, id: string, token: string): Promise<AppointmentLinkResult | null> {
  const row = await rowFromLink(event, 'cancel', id, token)
  if (!row) return null
  if (row.status === 'cancelled' || row.status === 'draft') return result(event, row, 'cancelled')
  if (Date.parse(row.startsAt) <= Date.now()) return result(event, row, row.status, { tooLate: true })
  const { refund } = appointmentCancelTerms(row)
  const refunded = await cancelWithRefund(event, row, refund, 'Cancelled by the customer')
  await sendAppointmentEmail(event, row, 'cancelled_by_you', undefined, refunded).catch(err => console.error('[appointments] Cancel email failed:', err))
  const place = await placeFor(event, row)
  notifyTeam(event, `Appointment cancelled: ${row.serviceName}`, `${row.name} cancelled ${whenText(row, place.timeZone, place.locale)}.`)
  return result(event, { ...row, status: 'cancelled' }, 'cancelled', { refund: refunded })
}

/** Refund (when asked and paid) first, so a refused refund leaves the booking as it was. */
async function cancelWithRefund(event: H3Event, row: AppointmentRow, refund: boolean, reason: string): Promise<boolean> {
  const db = useDb(event)
  let refunded = false
  if (refund && row.paymentStatus === 'paid' && row.stripePaymentIntentId) {
    await refundPayment(event, { paymentIntentId: row.stripePaymentIntentId, idempotencyKey: `appointment-cancel-${row.id}`, reason })
    refunded = true
  }
  const now = new Date().toISOString()
  await db.update(appointments)
    .set({ status: 'cancelled', cancelledAt: now, holdExpiresAt: null, ...(refunded ? { paymentStatus: 'refunded' as const } : {}), updatedAt: now })
    .where(and(eq(appointments.id, row.id), eq(appointments.siteId, row.siteId)))
  return refunded
}

// ── The team ────────────────────────────────────────────────────────────────

export async function listAppointments(event: H3Event, scope: 'upcoming' | 'past'): Promise<AdminAppointmentList> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  const rows = await db.query.appointments.findMany({
    where: and(
      eq(appointments.siteId, siteId),
      ne(appointments.status, 'draft'),
      scope === 'upcoming' ? gte(appointments.endsAt, now) : lt(appointments.endsAt, now),
      // Unconfirmed ones whose time ran out are clutter.
      or(inArray(appointments.status, ['confirmed', 'cancelled']), isLive(now)),
    ),
    orderBy: scope === 'upcoming' ? [asc(appointments.startsAt)] : [desc(appointments.startsAt)],
    limit: 300,
  })
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { timezone: true, locale: true } })
  const timeZone = site?.timezone || 'UTC'
  return {
    timeZone,
    appointments: rows.map(r => ({
      id: r.id,
      service: r.serviceName,
      startsAt: r.startsAt,
      when: whenText(r, timeZone, site?.locale || 'en'),
      name: r.name,
      email: r.email,
      phone: r.phone,
      note: r.note,
      // The query leaves drafts out.
      status: r.status as Exclude<typeof r.status, 'draft'>,
      price: r.price,
      currency: r.currency,
      paymentStatus: r.paymentStatus,
    })),
  }
}

/** The organiser cancels: always refunds what was paid. */
export async function cancelAppointmentByTeam(event: H3Event, id: string): Promise<{ refunded: boolean }> {
  const siteId = requireSiteId(event)
  const row = await useDb(event).query.appointments.findFirst({ where: and(eq(appointments.id, id), eq(appointments.siteId, siteId)) })
  if (!row) throw notFound('This appointment was not found.')
  if (row.status === 'cancelled' || row.status === 'draft') return { refunded: false }
  const refunded = await cancelWithRefund(event, row, true, 'Cancelled by the business')
  await sendAppointmentEmail(event, row, 'cancelled', undefined, refunded).catch(err => console.error('[appointments] Cancel email failed:', err))
  return { refunded }
}

// ── Stripe ──────────────────────────────────────────────────────────────────

/** The webhook: a paid checkout becomes a booking, or a refund if the time has gone. Safe twice. */
export async function settleAppointmentPayment(event: H3Event, payment: { appointmentId: string; sessionId: string; paymentIntentId: string | null; amount: number; currency: string }): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const row = await db.query.appointments.findFirst({ where: and(eq(appointments.id, payment.appointmentId), eq(appointments.siteId, siteId)) })
  if (!row || row.paymentStatus) return
  const now = new Date().toISOString()
  await db.update(appointments)
    .set({ paymentStatus: 'paid', amountPaid: payment.amount, currency: payment.currency, stripeSessionId: payment.sessionId, stripePaymentIntentId: payment.paymentIntentId, updatedAt: now })
    .where(and(eq(appointments.id, row.id), eq(appointments.siteId, siteId)))
  const paidRow = { ...row, paymentStatus: 'paid' as const, stripePaymentIntentId: payment.paymentIntentId }

  if (await claim(db, siteId, row.id, ['held', 'pending', 'cancelled'], 'confirmed', null)) {
    const place = await placeFor(event, paidRow)
    await sendAppointmentEmail(event, { ...paidRow, status: 'confirmed' }, 'booked', place).catch(err => console.error('[appointments] Booked email failed:', err))
    notifyTeam(event, `New appointment: ${row.serviceName}`, `${row.name} paid for ${whenText(row, place.timeZone, place.locale)}.`)
    return
  }
  // Paid after the time had gone to someone else.
  if (payment.paymentIntentId) {
    await refundPayment(event, { paymentIntentId: payment.paymentIntentId, idempotencyKey: `appointment-taken-${row.id}`, reason: 'The time was no longer free' })
  }
  await db.update(appointments)
    .set({ status: 'cancelled', cancelledAt: now, paymentStatus: 'refunded', updatedAt: now })
    .where(and(eq(appointments.id, row.id), eq(appointments.siteId, siteId)))
  await sendAppointmentEmail(event, paidRow, 'no_slot_refunded').catch(err => console.error('[appointments] Refund email failed:', err))
}

/** A checkout closed unpaid: the slot is let go. */
export async function releaseAppointmentCheckout(event: H3Event, appointmentId: string, sessionId: string): Promise<void> {
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  await useDb(event).update(appointments)
    .set({ status: 'cancelled', cancelledAt: now, holdExpiresAt: null, updatedAt: now })
    .where(and(eq(appointments.id, appointmentId), eq(appointments.siteId, siteId), eq(appointments.status, 'held'), eq(appointments.stripeSessionId, sessionId)))
}

/** Money went back in full (here or in Stripe's dashboard): the appointment is cancelled. */
export async function applyRefundToAppointments(event: H3Event, paymentIntentId: string): Promise<void> {
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  await useDb(event).update(appointments)
    .set({ status: 'cancelled', paymentStatus: 'refunded', cancelledAt: sql`coalesce(${appointments.cancelledAt}, ${now})`, updatedAt: now })
    .where(and(eq(appointments.siteId, siteId), eq(appointments.stripePaymentIntentId, paymentIntentId), ne(appointments.status, 'draft')))
}

// ── My bookings, reminders ──────────────────────────────────────────────────

/** Someone's upcoming appointments, for /booking/my. */
export async function listAppointmentsFor(event: H3Event, email: string) {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const now = new Date().toISOString()
  const rows = await db.query.appointments.findMany({
    where: and(eq(appointments.siteId, siteId), eq(appointments.email, normalizeEmail(email)), gte(appointments.endsAt, now), or(eq(appointments.status, 'confirmed'), isLive(now))),
    orderBy: [asc(appointments.startsAt)],
    limit: 50,
  })
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { timezone: true, locale: true } })
  return Promise.all(rows.map(async r => ({
    id: r.id,
    service: r.serviceName,
    when: whenText(r, site?.timezone || 'UTC', site?.locale || 'en'),
    status: r.status,
    cancelUrl: await appointmentLink(event, 'cancel', siteId, r.id),
  })))
}

/** Hourly, for one site's event: day-before reminders. The row is claimed before the email. */
export async function sendAppointmentReminder(event: H3Event, row: AppointmentRow): Promise<boolean> {
  const db = useDb(event)
  const [claimed] = await db.update(appointments)
    .set({ reminderSentAt: new Date().toISOString() })
    .where(and(eq(appointments.id, row.id), eq(appointments.siteId, row.siteId), eq(appointments.status, 'confirmed'), sql`${appointments.reminderSentAt} is null`))
    .returning({ id: appointments.id })
  if (!claimed) return false
  await sendAppointmentEmail(event, row, 'reminder')
  return true
}

/** Confirmed appointments starting within a day with no reminder yet, across every open site. */
export async function dueReminders(db: Db, limit = 200): Promise<AppointmentRow[]> {
  const now = new Date()
  const closed = db.select({ id: sites.id }).from(sites).where(or(eq(sites.status, 'suspended'), sql`${sites.moveState} is not null`))
  return db.query.appointments.findMany({
    where: and(
      eq(appointments.status, 'confirmed'),
      sql`${appointments.reminderSentAt} is null`,
      gte(appointments.startsAt, now.toISOString()),
      lt(appointments.startsAt, new Date(now.getTime() + REMINDER_MS).toISOString()),
      notInArray(appointments.siteId, closed),
    ),
    orderBy: [asc(appointments.startsAt)],
    limit,
  })
}
