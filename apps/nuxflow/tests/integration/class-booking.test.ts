/**
 * Booking classes end to end through the routes: repeating dates, card payments (held
 * places, the webhook, refunds), the paid waitlist, class passes without an account,
 * cancellation rules, and the hourly sweep. Stripe is the only thing not real here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import type * as SettingsModule from '../../server/utils/settings'
import { and, eq } from 'drizzle-orm'
import { addDays, floatingDate } from '@nuxflow/canvas/events'
import { classPasses, classPassHoldings, contentItems, eventRsvps, subscriptions } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedContentItem, seedContentType, seedRole, seedSetting, seedSite, seedTier, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/edge-cache', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  purgeContentCache: vi.fn().mockResolvedValue(undefined),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))
vi.mock('../../server/utils/embeddings', () => ({
  upsertContentEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteContentEmbedding: vi.fn().mockResolvedValue(undefined),
}))

const { mockSend, stripe } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ messageId: 'm-1' }),
  stripe: {
    createPaymentCheckout: vi.fn(),
    getCheckoutSession: vi.fn(),
    expireCheckoutSession: vi.fn(),
    refundPayment: vi.fn(),
    findCustomerForSite: vi.fn(),
    createCustomer: vi.fn(),
  },
}))
vi.mock('../../server/utils/email', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmailWithConfig: mockSend,
}))
vi.mock('../../server/utils/payments/stripe', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  StripeProvider: vi.fn().mockImplementation(function () { return stripe }),
}))
// The Stripe key and webhook secret are stored encrypted; here they just need to exist.
vi.mock('../../server/utils/settings', async (importOriginal) => {
  const original = await importOriginal<typeof SettingsModule>()
  return {
    ...original,
    resolveStringSetting: async (event: H3Event, key: string, envKey?: string) => {
      if (key === 'payments.stripe_secret_key' || key === 'payments.stripe_webhook_secret') {
        return event.context.siteId === 'site-book-nopay' ? '' : 'configured'
      }
      return original.resolveStringSetting(event, key, envKey)
    },
  }
})

const { default: rsvpGet } = await import('../../server/api/public/rsvp/[id].get')
const { default: rsvpPost } = await import('../../server/api/public/rsvp/[id].post')
const { default: rsvpLink } = await import('../../server/api/public/rsvp/link.post')
const { default: passesGet } = await import('../../server/api/public/class-passes/index.get')
const { default: passBuy } = await import('../../server/api/public/class-passes/index.post')
const { default: bookingsPost } = await import('../../server/api/public/bookings.post')
const { default: eventsHandler } = await import('../../server/api/public/events.get')
const { default: feedHandler } = await import('../../server/routes/events.ics')
const { default: calendarHandler } = await import('../../server/api/v1/content/calendar.get')
const { default: listRsvps } = await import('../../server/api/v1/rsvps/index.get')
const { default: addOrCancel } = await import('../../server/api/v1/rsvps/index.post')
const { default: patchRsvp } = await import('../../server/api/v1/rsvps/[id].patch')
const { default: deleteRsvp } = await import('../../server/api/v1/rsvps/[id].delete')
const { default: deleteContent } = await import('../../server/api/v1/content/[id].delete')
const { default: passAdminPost } = await import('../../server/api/v1/class-passes/index.post')
const { default: passAdminPatch } = await import('../../server/api/v1/class-passes/[id].patch')
const { default: checkoutTier } = await import('../../server/api/v1/memberships/checkout.post')
const { handleChargeRefunded, handleOneOffCheckoutCompleted, handleOneOffCheckoutExpired } = await import('../../server/utils/booking-webhooks')
const { reconcileBookings, rsvpToken } = await import('../../server/utils/event-rsvp')
const { bookingAccessToken } = await import('../../server/utils/class-passes')
const { sweepEventBookings } = await import('../../server/scheduled/event-bookings')

type Handler = (e: H3Event) => Promise<unknown>
type Row = typeof eventRsvps.$inferSelect

const SITE = 'site-book-01'
const OTHER = 'site-book-02'
const NO_PAY = 'site-book-nopay'

let editorId: string
let adminId: string
let eventType: string
let noPayType: string
let passId: string
let seq = 0

const db = () => getCurrentTestDb()
const today = new Date().toISOString().slice(0, 10)
const inDays = (n: number, time = 'T18:00:00.000Z') => `${addDays(today, n)}${time}`
const email = (name: string) => `${name}-${++seq}@visitors.test`

function ev(opts: { userId?: string; siteId?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: opts.userId ? { user: { id: opts.userId, name: 'U', email: 'staff@test.test' } } : undefined,
    body: opts.body,
    params: opts.params,
    query: opts.query,
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: { host: 'book.localhost', 'cf-connecting-ip': '203.0.113.9' },
  }) as unknown as H3Event
}

async function seedClass(overrides: Partial<typeof contentItems.$inferInsert> = {}, siteId = SITE, typeId = eventType) {
  return seedContentItem(db(), siteId, typeId, {
    title: 'Yoga',
    slug: `yoga-${++seq}`,
    status: 'published',
    visibility: 'public',
    eventStartAt: inDays(10),
    eventEndAt: inDays(10, 'T19:00:00.000Z'),
    eventRsvpEnabled: true,
    eventPrice: 12,
    eventCurrency: 'GBP',
    ...overrides,
  })
}

const book = (id: string, body: Record<string, unknown>) => (rsvpPost as Handler)(ev({ params: { id }, body: { name: 'V', seats: 1, ...body } })) as Promise<{ status: string; url?: string }>
const row = async (itemId: string, address: string, date = '') => (await db().query.eventRsvps.findFirst({
  where: and(eq(eventRsvps.contentItemId, itemId), eq(eventRsvps.email, address), eq(eventRsvps.occurrenceDate, date)),
})) as Row
const link = (action: string, id: string, token: string, method?: string) => (rsvpLink as Handler)(ev({ body: { action, id, token, method } })) as Promise<{ status: string; url?: string; payUrl?: string; terms?: { refund: string | null; tooLate: boolean } }>
const confirm = async (r: Row) => link('confirm', r.id, await rsvpToken('confirm', SITE, r.id))
const cancel = async (r: Row) => link('cancel', r.id, await rsvpToken('cancel', SITE, r.id))
const pay = async (r: Row, method: string) => link('pay', r.id, await rsvpToken('pay', SITE, r.id), method)

/** What Stripe's webhook says when the checkout for this booking is paid. */
function paidSession(r: Row, over: Record<string, unknown> = {}) {
  return {
    id: r.stripeSessionId!,
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: `pi_${r.id}`,
    amount_total: 1200 * r.seats,
    currency: 'gbp',
    metadata: { nuxflowBooking: 'rsvp', siteId: SITE, rsvpId: r.id },
    ...over,
  }
}
const settle = (r: Row, over?: Record<string, unknown>) => handleOneOffCheckoutCompleted(ev(), paidSession(r, over))

async function bookAndPay(itemId: string, address: string, date?: string) {
  const answer = await book(itemId, { email: address, date })
  expect(answer.status).toBe('checkout')
  const held = await row(itemId, address, date ?? '')
  await settle(held)
  return row(itemId, address, date ?? '')
}

async function seedHolding(address: string, credits = 5, overrides: Partial<typeof classPassHoldings.$inferInsert> = {}) {
  const id = `hold-${++seq}`
  await db().insert(classPassHoldings).values({
    id, siteId: SITE, passId, passName: '5 classes', email: address, name: 'V', creditsTotal: credits, amountPaid: 50, currency: 'GBP',
    stripeSessionId: `cs_h_${id}`, stripePaymentIntentId: `pi_h_${id}`, ...overrides,
  })
  return id
}
const holding = async (id: string) => db().query.classPassHoldings.findFirst({ where: eq(classPassHoldings.id, id) })

const sentTo = (address: string) => mockSend.mock.calls.filter(c => JSON.stringify(c).includes(address))
const lastSubject = (address: string) => {
  const calls = sentTo(address)
  return (calls.at(-1)?.[1] as { subject?: string } | undefined)?.subject
}

beforeAll(async () => {
  await initTestDb()
  await seedSite(db(), { id: SITE, domain: 'book.localhost', timezone: 'UTC' })
  await seedSite(db(), { id: OTHER, domain: 'other-book.localhost', timezone: 'UTC' })
  await seedSite(db(), { id: NO_PAY, domain: 'nopay.localhost', timezone: 'UTC' })
  editorId = await seedUser(db(), { email: 'editor@book.test' })
  adminId = await seedUser(db(), { email: 'admin@book.test' })
  await seedRole(db(), editorId, SITE, 'editor')
  await seedRole(db(), adminId, SITE, 'admin')
  eventType = await seedContentType(db(), SITE, { slug: 'event', name: 'Events', singularName: 'Event' })
  noPayType = await seedContentType(db(), NO_PAY, { slug: 'event', name: 'Events', singularName: 'Event' })
  for (const site of [SITE, NO_PAY]) {
    await seedSetting(db(), site, 'email.provider', 'resend')
    await seedSetting(db(), site, 'email.resend_api_key', 're_test_key')
  }
  passId = 'pass-five'
  await db().insert(classPasses).values({ id: passId, siteId: SITE, name: '5 classes', credits: 5, price: 50, currency: 'GBP', validDays: 90 })
})

afterAll(teardownTestDb)

beforeEach(() => {
  mockSend.mockClear()
  mockSend.mockResolvedValue({ messageId: 'm-1' })
  for (const fn of Object.values(stripe)) fn.mockReset()
  let n = 0
  stripe.createPaymentCheckout.mockImplementation(async () => {
    n++
    return { id: `cs_${Date.now()}_${n}_${Math.random().toString(36).slice(2)}`, url: `https://checkout.stripe.test/${n}` }
  })
  stripe.getCheckoutSession.mockResolvedValue({ id: 'cs', status: 'open' })
  stripe.expireCheckoutSession.mockResolvedValue({})
  stripe.refundPayment.mockResolvedValue({ id: 're_1' })
  stripe.findCustomerForSite.mockResolvedValue({ id: 'cus_1' })
})

describe('repeating events', () => {
  const series = () => seedClass({
    eventStartAt: inDays(-14),
    eventEndAt: inDays(-14, 'T19:00:00.000Z'),
    eventRecurrence: { freq: 'daily', interval: 7 },
    eventRsvpCapacity: 1,
    eventPrice: null,
  })

  it('offers the coming dates, each with its own places', async () => {
    const id = await series()
    const before = await (rsvpGet as Handler)(ev({ params: { id } })) as { dates: Array<{ date: string; spotsLeft: number }> }
    // Looked up by date: today's class is also listed until 19:00 UTC, when it ends.
    const first = addDays(today, 7)
    expect(before.dates.find(d => d.date === first)?.spotsLeft).toBe(1)

    const a = email('a')
    await book(id, { email: a, date: first })
    await confirm(await row(id, a, first))

    const after = await (rsvpGet as Handler)(ev({ params: { id } })) as { dates: Array<{ date: string; state: string; spotsLeft: number }> }
    expect(after.dates.find(d => d.date === first)).toMatchObject({ state: 'waitlist', spotsLeft: 0 })
    expect(after.dates.find(d => d.date === addDays(today, 14))).toMatchObject({ state: 'open', spotsLeft: 1 })
  })

  it('lets the same person book two dates', async () => {
    const id = await series()
    const a = email('a')
    await book(id, { email: a, date: addDays(today, 7) })
    await book(id, { email: a, date: addDays(today, 14) })
    expect((await row(id, a, addDays(today, 7))).status).toBe('pending')
    expect((await row(id, a, addDays(today, 14))).startsAt).toBe(inDays(14))
  })

  it('refuses a booking with no date, or a date not in the series', async () => {
    const id = await series()
    await expect(book(id, { email: email('a') })).rejects.toMatchObject({ statusCode: 422 })
    await expect(book(id, { email: email('a'), date: addDays(today, 8) })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('lists each date on public surfaces, with its own link and calendar entry', async () => {
    const id = await series()
    const { events } = await (eventsHandler as Handler)(ev({ query: { from: floatingDate(today), to: floatingDate(addDays(today, 15)) } })) as { events: Array<{ id: string; date: string | null; path: string; icsUrl: string; eventStartAt: string }> }
    const dates = events.filter(e => e.id === id)
    expect(dates.map(e => e.date)).toEqual([today, addDays(today, 7), addDays(today, 14)])
    expect(dates[1]).toMatchObject({ eventStartAt: inDays(7) })
    expect(dates[1]!.path).toContain(`?date=${addDays(today, 7)}`)
    expect(dates[1]!.icsUrl).toContain(`?date=${addDays(today, 7)}`)

    const ics = await (feedHandler as Handler)(ev()) as string
    expect(ics).toContain(`UID:${id}-${addDays(today, 7)}@`)
  })

  it('shows dates on the admin calendar, not to be dragged', async () => {
    const id = await series()
    const { items } = await (calendarHandler as Handler)(ev({ userId: editorId, query: { from: today, to: addDays(today, 8) } })) as { items: Array<{ id: string; calendarDate: string; repeats?: boolean }> }
    const dates = items.filter(i => i.id === id)
    expect(dates.map(i => i.calendarDate)).toEqual([today, addDays(today, 7)])
    expect(dates.every(i => i.repeats)).toBe(true)
  })

  it('leaves out a date taken out of the series', async () => {
    const id = await seedClass({ eventStartAt: inDays(-14), eventEndAt: null, eventPrice: null, eventRecurrence: { freq: 'daily', interval: 7, skip: [addDays(today, 7)] } })
    const { dates } = await (rsvpGet as Handler)(ev({ params: { id } })) as { dates: Array<{ date: string }> }
    expect(dates.map(d => d.date)).not.toContain(addDays(today, 7))
    await expect(book(id, { email: email('a'), date: addDays(today, 7) })).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('paying by card', () => {
  it('holds the place and sends the visitor to Stripe, with no email step', async () => {
    const id = await seedClass({ eventRsvpCapacity: 5 })
    const a = email('a')
    const answer = await book(id, { email: a, seats: 2 })
    expect(answer.status).toBe('checkout')
    expect(answer.url).toContain('checkout.stripe.test')

    const held = await row(id, a)
    expect(held.status).toBe('held')
    expect(held.holdExpiresAt).toBeTruthy()
    expect(mockSend).not.toHaveBeenCalled()

    const args = stripe.createPaymentCheckout.mock.calls[0]![0]
    expect(args).toMatchObject({ customerEmail: a, item: { amount: 12, currency: 'GBP', quantity: 2 }, metadata: { nuxflowKind: 'booking', siteId: SITE, rsvpId: held.id } })
    // Stripe's minimum, and the place outlasts it.
    expect(args.expiresInMinutes).toBeGreaterThanOrEqual(30)
    expect(Date.parse(held.holdExpiresAt!)).toBeGreaterThan(Date.now() + args.expiresInMinutes * 60_000)
  })

  it('books them when the webhook arrives, once however often it is delivered', async () => {
    const id = await seedClass()
    const a = email('a')
    await book(id, { email: a })
    const held = await row(id, a)

    await settle(held)
    const booked = await row(id, a)
    expect(booked).toMatchObject({ status: 'confirmed', paymentMethod: 'card', paymentStatus: 'paid', amountPaid: 12, currency: 'GBP', stripePaymentIntentId: `pi_${held.id}`, holdExpiresAt: null })
    expect(lastSubject(a)).toContain('You\'re booked')

    mockSend.mockClear()
    await settle(held)
    expect(mockSend).not.toHaveBeenCalled()
    expect(stripe.refundPayment).not.toHaveBeenCalled()
  })

  it('counts a place being paid for, so the last one can\'t be sold twice', async () => {
    const id = await seedClass({ eventRsvpCapacity: 1 })
    const a = email('a')
    const b = email('b')
    expect((await book(id, { email: a })).status).toBe('checkout')
    // The second visitor doesn't reach Stripe: they're asked to confirm for the waitlist.
    expect((await book(id, { email: b })).status).toBe('pending')
    expect(stripe.createPaymentCheckout).toHaveBeenCalledTimes(1)
    expect((await (rsvpGet as Handler)(ev({ params: { id } })) as { state: string }).state).toBe('waitlist')
    expect(await confirm(await row(id, b))).toMatchObject({ status: 'waitlist' })
  })

  it('stops counting a hold whose time is up', async () => {
    const id = await seedClass({ eventRsvpCapacity: 1 })
    const a = email('a')
    await book(id, { email: a })
    await db().update(eventRsvps).set({ holdExpiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(eventRsvps.id, (await row(id, a)).id))
    expect((await book(id, { email: email('b') })).status).toBe('checkout')
  })

  it('closes the old checkout when someone starts again, and won\'t charge twice if it was paid', async () => {
    const id = await seedClass()
    const a = email('a')
    await book(id, { email: a })
    const first = await row(id, a)

    expect((await book(id, { email: a })).status).toBe('checkout')
    expect(stripe.expireCheckoutSession).toHaveBeenCalledTimes(1)
    expect((await row(id, a)).stripeSessionId).not.toBe(first.stripeSessionId)

    stripe.getCheckoutSession.mockResolvedValue({ id: 'cs', status: 'complete' })
    expect((await book(id, { email: a })).status).toBe('pending')
    expect(stripe.createPaymentCheckout).toHaveBeenCalledTimes(2)
  })

  it('refunds a payment that lands after the place has gone', async () => {
    const id = await seedClass({ eventRsvpCapacity: 1 })
    const a = email('a')
    await book(id, { email: a })
    const held = await row(id, a)
    const now = new Date().toISOString()
    await db().update(eventRsvps).set({ status: 'cancelled', cancelledAt: now, holdExpiresAt: null }).where(eq(eventRsvps.id, held.id))
    await bookAndPay(id, email('b'))

    await settle(held)
    expect(stripe.refundPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: `pi_${held.id}` }))
    expect((await row(id, a)).status).toBe('cancelled')
    expect(lastSubject(a)).toContain('refunded')
  })

  it('gives a late payment the place if it is still free', async () => {
    const id = await seedClass({ eventRsvpCapacity: 1 })
    const a = email('a')
    await book(id, { email: a })
    const held = await row(id, a)
    await db().update(eventRsvps).set({ status: 'cancelled', cancelledAt: new Date().toISOString(), holdExpiresAt: null }).where(eq(eventRsvps.id, held.id))
    await settle(held)
    expect((await row(id, a)).status).toBe('confirmed')
    expect(stripe.refundPayment).not.toHaveBeenCalled()
  })

  it('releases the place when the checkout expires, and only for the latest attempt', async () => {
    const id = await seedClass({ eventRsvpCapacity: 1 })
    const a = email('a')
    await book(id, { email: a })
    const first = await row(id, a)
    await book(id, { email: a })

    await handleOneOffCheckoutExpired(ev(), paidSession(first))
    expect((await row(id, a)).status).toBe('held')

    await handleOneOffCheckoutExpired(ev(), paidSession(await row(id, a)))
    expect((await row(id, a)).status).toBe('cancelled')
  })

  it('ignores a webhook meant for another site', async () => {
    const id = await seedClass()
    const a = email('a')
    await book(id, { email: a })
    const held = await row(id, a)
    await expect(handleOneOffCheckoutCompleted(ev({ siteId: OTHER }), paidSession(held))).rejects.toThrow()
    expect((await row(id, a)).status).toBe('held')
  })

  it('shows a paid event as closed where payments aren\'t set up, and refuses to start', async () => {
    const id = await seedClass({}, NO_PAY, noPayType)
    const state = await (rsvpGet as Handler)(ev({ siteId: NO_PAY, params: { id } })) as { state: string; canPayByCard: boolean }
    expect(state).toMatchObject({ state: 'closed', canPayByCard: false })
    await expect((rsvpPost as Handler)(ev({ siteId: NO_PAY, params: { id }, body: { name: 'V', email: email('a'), seats: 1 } }))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('leaves free events exactly as they were', async () => {
    const id = await seedClass({ eventPrice: null })
    const a = email('a')
    expect((await book(id, { email: a })).status).toBe('pending')
    expect(lastSubject(a)).toContain('Confirm your place')
    expect(await confirm(await row(id, a))).toMatchObject({ status: 'confirmed' })
    expect(stripe.createPaymentCheckout).not.toHaveBeenCalled()
  })
})

describe('the waitlist on a paid event', () => {
  async function fullWithWaiter() {
    const id = await seedClass({ eventRsvpCapacity: 1 })
    const booked = await bookAndPay(id, email('booked'))
    const waiter = email('waiter')
    await book(id, { email: waiter })
    await confirm(await row(id, waiter))
    return { id, booked, waiter }
  }

  it('keeps a freed place for the next person rather than giving it to them', async () => {
    const { id, booked, waiter } = await fullWithWaiter()
    await cancel(booked)
    const offered = await row(id, waiter)
    expect(offered.status).toBe('offered')
    expect(Date.parse(offered.holdExpiresAt!)).toBeGreaterThan(Date.now())
    expect(offered.paymentStatus).toBeNull()
    expect(lastSubject(waiter)).toContain('A place opened up')
    // It counts: a newcomer can't take it.
    expect((await book(id, { email: email('new') })).status).toBe('pending')
  })

  it('lets them pay by card from the link, then books them', async () => {
    const { id, booked, waiter } = await fullWithWaiter()
    await cancel(booked)
    const answer = await pay(await row(id, waiter), 'card')
    expect(answer.status).toBe('checkout')
    const held = await row(id, waiter)
    expect(held.status).toBe('held')
    await settle(held)
    expect((await row(id, waiter)).status).toBe('confirmed')
  })

  it('lets them use a pass from the link, with no second email', async () => {
    const { id, booked, waiter } = await fullWithWaiter()
    await cancel(booked)
    const holdingId = await seedHolding(waiter, 3)
    expect(await pay(await row(id, waiter), 'pass')).toMatchObject({ status: 'confirmed' })
    expect((await row(id, waiter))).toMatchObject({ status: 'confirmed', paymentMethod: 'pass', paymentStatus: 'paid', creditsSpent: 1 })
    expect((await holding(holdingId))?.creditsUsed).toBe(1)
  })

  it('moves on to the next person when an offer runs out', async () => {
    const { id, booked, waiter } = await fullWithWaiter()
    const second = email('second')
    await book(id, { email: second })
    await confirm(await row(id, second))
    await cancel(booked)

    await db().update(eventRsvps).set({ holdExpiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(eventRsvps.id, (await row(id, waiter)).id))
    const result = await sweepEventBookings()
    expect(result.expired).toBeGreaterThanOrEqual(1)
    expect((await row(id, waiter)).status).toBe('cancelled')
    expect(lastSubject(waiter)).toContain('released')
    expect((await row(id, second)).status).toBe('offered')
  })

  it('refuses to pay for an offer that has run out', async () => {
    const { id, booked, waiter } = await fullWithWaiter()
    await cancel(booked)
    await db().update(eventRsvps).set({ holdExpiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(eventRsvps.id, (await row(id, waiter)).id))
    stripe.createPaymentCheckout.mockClear()
    expect(await pay(await row(id, waiter), 'card')).toMatchObject({ status: 'closed' })
    expect(stripe.createPaymentCheckout).not.toHaveBeenCalled()
  })
})

describe('cancelling', () => {
  it('refunds a card booking in time, and frees the place', async () => {
    const id = await seedClass({ eventCancelHours: 24 })
    const booked = await bookAndPay(id, email('a'))
    expect(await link('describe-cancel', booked.id, await rsvpToken('cancel', SITE, booked.id))).toMatchObject({ terms: { refund: 'card', tooLate: false } })

    await cancel(booked)
    expect(stripe.refundPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: booked.stripePaymentIntentId, idempotencyKey: expect.stringContaining(booked.id) }))
    expect(await db().query.eventRsvps.findFirst({ where: eq(eventRsvps.id, booked.id) })).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' })
  })

  it('gives nothing back past the deadline, but still frees the place', async () => {
    const id = await seedClass({ eventStartAt: inDays(1), eventEndAt: null, eventCancelHours: 24 * 7 })
    const booked = await bookAndPay(id, email('a'))
    expect(await link('describe-cancel', booked.id, await rsvpToken('cancel', SITE, booked.id))).toMatchObject({ terms: { refund: null, tooLate: true } })
    await cancel(booked)
    expect(stripe.refundPayment).not.toHaveBeenCalled()
    expect(await db().query.eventRsvps.findFirst({ where: eq(eventRsvps.id, booked.id) })).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' })
  })

  it('always refunds when the organiser cancels, whatever the deadline', async () => {
    const id = await seedClass({ eventStartAt: inDays(1), eventEndAt: null, eventCancelHours: 24 * 7 })
    const booked = await bookAndPay(id, email('a'))
    await (patchRsvp as Handler)(ev({ userId: editorId, params: { id: booked.id }, body: { status: 'cancelled' } }))
    expect(stripe.refundPayment).toHaveBeenCalledTimes(1)
  })

  it('leaves the booking in place if Stripe refuses the refund', async () => {
    const id = await seedClass()
    const booked = await bookAndPay(id, email('a'))
    stripe.refundPayment.mockRejectedValue(new Error('insufficient funds'))
    await expect((patchRsvp as Handler)(ev({ userId: editorId, params: { id: booked.id }, body: { status: 'cancelled' } }))).rejects.toMatchObject({ statusCode: 502 })
    expect(await db().query.eventRsvps.findFirst({ where: eq(eventRsvps.id, booked.id) })).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' })
  })

  it('won\'t move someone who paid onto the waitlist, or erase them unrefunded', async () => {
    const id = await seedClass()
    const booked = await bookAndPay(id, email('a'))
    await expect((patchRsvp as Handler)(ev({ userId: editorId, params: { id: booked.id }, body: { status: 'waitlist' } }))).rejects.toMatchObject({ statusCode: 409 })
    await expect((deleteRsvp as Handler)(ev({ userId: editorId, params: { id: booked.id } }))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('follows a full refund made in Stripe\'s dashboard, but not a partial one', async () => {
    const id = await seedClass()
    const booked = await bookAndPay(id, email('a'))
    const charge = { payment_intent: booked.stripePaymentIntentId, amount: 1200, currency: 'gbp' }

    await handleChargeRefunded(ev(), { ...charge, amount_refunded: 200 })
    expect((await db().query.eventRsvps.findFirst({ where: eq(eventRsvps.id, booked.id) }))?.status).toBe('confirmed')

    await handleChargeRefunded(ev(), { ...charge, amount_refunded: 1200 })
    expect(await db().query.eventRsvps.findFirst({ where: eq(eventRsvps.id, booked.id) })).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' })
    // Stripe already has the refund: asking for another would fail.
    expect(stripe.refundPayment).not.toHaveBeenCalled()
  })
})

describe('calling off a date, and changing an event', () => {
  it('cancels one date of a series with everyone refunded, leaving the others', async () => {
    const id = await seedClass({ eventStartAt: inDays(-7), eventEndAt: null, eventRecurrence: { freq: 'daily', interval: 7 } })
    const date = addDays(today, 7)
    const kept = addDays(today, 14)
    const a = email('a')
    await bookAndPay(id, a, date)
    await bookAndPay(id, a, kept)

    const result = await (addOrCancel as Handler)(ev({ userId: editorId, body: { action: 'cancel-date', event: id, date } })) as { cancelled: number; failed: number }
    expect(result).toEqual({ cancelled: 1, failed: 0 })
    expect((await row(id, a, date)).paymentStatus).toBe('refunded')
    expect((await row(id, a, kept)).status).toBe('confirmed')
    expect(lastSubject(a)).toContain('Cancelled')

    const item = await db().query.contentItems.findFirst({ where: eq(contentItems.id, id) })
    expect(item?.eventRecurrence?.skip).toEqual([date])
  })

  it('reports refunds that failed, and running it again finishes the job', async () => {
    const id = await seedClass()
    const a = email('a')
    await bookAndPay(id, a)
    stripe.refundPayment.mockRejectedValueOnce(new Error('no'))
    expect(await (addOrCancel as Handler)(ev({ userId: editorId, body: { action: 'cancel-date', event: id } }))).toEqual({ cancelled: 0, failed: 1 })
    expect((await row(id, a)).status).toBe('confirmed')
    expect(await (addOrCancel as Handler)(ev({ userId: editorId, body: { action: 'cancel-date', event: id } }))).toEqual({ cancelled: 1, failed: 0 })
  })

  it('tells people when the time changes, and moves their reminder', async () => {
    const id = await seedClass()
    const a = email('a')
    await bookAndPay(id, a)
    await db().update(eventRsvps).set({ reminderSentAt: new Date().toISOString() }).where(eq(eventRsvps.id, (await row(id, a)).id))
    await db().update(contentItems).set({ eventStartAt: inDays(11) }).where(eq(contentItems.id, id))

    await reconcileBookings(ev(), id, { timesChanged: true, placeChanged: false })
    expect(await row(id, a)).toMatchObject({ startsAt: inDays(11), reminderSentAt: null })
    expect(lastSubject(a)).toContain('Details changed')
  })

  it('refunds people whose date a rule change removed', async () => {
    const id = await seedClass({ eventStartAt: inDays(-7), eventEndAt: null, eventRecurrence: { freq: 'daily', interval: 7 } })
    const date = addDays(today, 7)
    const a = email('a')
    await bookAndPay(id, a, date)
    await db().update(contentItems).set({ eventRecurrence: { freq: 'daily', interval: 7, until: today } }).where(eq(contentItems.id, id))

    await reconcileBookings(ev(), id, { timesChanged: true, placeChanged: false })
    expect(await row(id, a, date)).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' })
    expect(lastSubject(a)).toContain('Cancelled')
  })

  it('keeps bookings when a one-off becomes a series', async () => {
    const id = await seedClass()
    const a = email('a')
    await bookAndPay(id, a)
    await db().update(contentItems).set({ eventRecurrence: { freq: 'daily', interval: 7 } }).where(eq(contentItems.id, id))
    await reconcileBookings(ev(), id, { timesChanged: true, placeChanged: false })
    expect(await row(id, a, addDays(today, 10))).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' })
  })

  it('refuses to delete an event with paid bookings still to come', async () => {
    const id = await seedClass()
    await bookAndPay(id, email('a'))
    await expect((deleteContent as Handler)(ev({ userId: editorId, params: { id } }))).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('class passes, with no account', () => {
  it('lists what is on sale', async () => {
    const { passes, canBuy } = await (passesGet as Handler)(ev()) as { passes: Array<{ id: string }>; canBuy: boolean }
    expect(canBuy).toBe(true)
    expect(passes.map(p => p.id)).toContain(passId)
  })

  it('sends a buyer to Stripe, and makes the pass once however often the webhook comes', async () => {
    const a = email('buyer')
    const { url } = await (passBuy as Handler)(ev({ body: { passId, name: 'B', email: a } })) as { url: string }
    expect(url).toContain('checkout.stripe.test')
    const { metadata } = stripe.createPaymentCheckout.mock.calls[0]![0]

    const session = { id: `cs_pass_${++seq}`, mode: 'payment', payment_status: 'paid', payment_intent: `pi_p_${seq}`, amount_total: 5000, currency: 'gbp', metadata }
    await handleOneOffCheckoutCompleted(ev(), session)
    await handleOneOffCheckoutCompleted(ev(), session)

    const held = await db().query.classPassHoldings.findMany({ where: eq(classPassHoldings.email, a) })
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ creditsTotal: 5, creditsUsed: 0, amountPaid: 50, status: 'active', passName: '5 classes' })
    expect(Date.parse(held[0]!.expiresAt!)).toBeGreaterThan(Date.now() + 89 * 86_400_000)
    expect(sentTo(a)).toHaveLength(1)
  })

  it('refunds a pass deleted while the buyer was paying', async () => {
    const session = { id: `cs_gone_${++seq}`, mode: 'payment', payment_status: 'paid', payment_intent: `pi_g_${seq}`, amount_total: 100, currency: 'gbp', metadata: { nuxflowBooking: 'pass', siteId: SITE, passId: 'no-such-pass', email: email('a') } }
    await handleOneOffCheckoutCompleted(ev(), session)
    expect(stripe.refundPayment).toHaveBeenCalledTimes(1)
  })

  it('spends nothing until the emailed link is pressed', async () => {
    const id = await seedClass()
    const a = email('a')
    const holdingId = await seedHolding(a)
    expect((await book(id, { email: a, method: 'pass' })).status).toBe('pending')
    expect((await holding(holdingId))?.creditsUsed).toBe(0)
    expect(lastSubject(a)).toContain('Use your pass')

    expect(await confirm(await row(id, a))).toMatchObject({ status: 'confirmed' })
    expect((await holding(holdingId))?.creditsUsed).toBe(1)
    expect(await row(id, a)).toMatchObject({ status: 'confirmed', paymentMethod: 'pass', paymentStatus: 'paid', creditsSpent: 1, passHoldingId: holdingId })
    expect(stripe.createPaymentCheckout).not.toHaveBeenCalled()
  })

  it('takes one credit per place, and refuses more than the pass has', async () => {
    const id = await seedClass()
    const a = email('a')
    const holdingId = await seedHolding(a, 2)
    await book(id, { email: a, method: 'pass', seats: 3 })
    expect(await confirm(await row(id, a))).toMatchObject({ status: 'no_pass' })
    expect((await holding(holdingId))?.creditsUsed).toBe(0)
  })

  it('answers the same for an address with no pass, until the link is pressed', async () => {
    const id = await seedClass()
    const a = email('nopass')
    expect((await book(id, { email: a, method: 'pass' })).status).toBe('pending')
    expect(await confirm(await row(id, a))).toMatchObject({ status: 'no_pass' })
  })

  it('won\'t use a pass that has expired by the time of the class', async () => {
    const id = await seedClass({ eventStartAt: inDays(30), eventEndAt: null })
    const a = email('a')
    await seedHolding(a, 5, { expiresAt: inDays(10) })
    await book(id, { email: a, method: 'pass' })
    expect(await confirm(await row(id, a))).toMatchObject({ status: 'no_pass' })
  })

  it('uses the pass that runs out first', async () => {
    const id = await seedClass()
    const a = email('a')
    const forever = await seedHolding(a, 5)
    const soon = await seedHolding(a, 5, { expiresAt: inDays(20) })
    await book(id, { email: a, method: 'pass' })
    await confirm(await row(id, a))
    expect((await holding(soon))?.creditsUsed).toBe(1)
    expect((await holding(forever))?.creditsUsed).toBe(0)
  })

  it('gives credits back on a timely cancellation, once', async () => {
    const id = await seedClass()
    const a = email('a')
    const holdingId = await seedHolding(a)
    await book(id, { email: a, method: 'pass' })
    const r = await row(id, a)
    await confirm(r)
    const booked = await row(id, a)
    await cancel(booked)
    await cancel(booked)
    expect((await holding(holdingId))?.creditsUsed).toBe(0)
    expect(await row(id, a)).toMatchObject({ status: 'cancelled', creditsSpent: 0, paymentStatus: 'refunded' })
  })

  it('keeps the credit when it\'s too late to cancel', async () => {
    const id = await seedClass({ eventStartAt: inDays(1), eventEndAt: null, eventCancelHours: 24 * 7 })
    const a = email('a')
    const holdingId = await seedHolding(a)
    await book(id, { email: a, method: 'pass' })
    await confirm(await row(id, a))
    await cancel(await row(id, a))
    expect((await holding(holdingId))?.creditsUsed).toBe(1)
  })

  it('gives the credit straight back if the class filled up before the link was pressed', async () => {
    const id = await seedClass({ eventRsvpCapacity: 1 })
    const a = email('a')
    const holdingId = await seedHolding(a)
    await book(id, { email: a, method: 'pass' })
    await bookAndPay(id, email('b'))
    expect(await confirm(await row(id, a))).toMatchObject({ status: 'waitlist' })
    expect((await holding(holdingId))?.creditsUsed).toBe(0)
  })

  it('refuses a pass on an event that doesn\'t take them', async () => {
    const id = await seedClass({ eventPassesAllowed: false })
    await expect(book(id, { email: email('a'), method: 'pass' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('refunds unused credits at their share of the price, then stops the pass', async () => {
    const a = email('a')
    const holdingId = await seedHolding(a, 5, { creditsUsed: 2 })
    const result = await (passAdminPatch as Handler)(ev({ userId: adminId, params: { id: holdingId }, body: { action: 'refund-holding' } }))
    expect(result).toEqual({ refunded: 30 })
    expect(stripe.refundPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 30, currency: 'GBP', paymentIntentId: expect.stringContaining('pi_h_') }))
    expect(await holding(holdingId)).toMatchObject({ status: 'refunded', amountRefunded: 30 })
  })

  it('stops a pass refunded in full from Stripe\'s dashboard', async () => {
    const a = email('a')
    const holdingId = await seedHolding(a)
    const h = await holding(holdingId)
    await handleChargeRefunded(ev(), { payment_intent: h!.stripePaymentIntentId, amount: 5000, amount_refunded: 5000, currency: 'gbp' })
    expect(await holding(holdingId)).toMatchObject({ status: 'refunded', amountRefunded: 50 })
  })

  it('lets the team add a pass sold in person, and tells the holder', async () => {
    const a = email('desk')
    await (passAdminPost as Handler)(ev({ userId: adminId, body: { action: 'grant', passId, name: 'D', email: a } }))
    const held = await db().query.classPassHoldings.findFirst({ where: eq(classPassHoldings.email, a) })
    expect(held).toMatchObject({ creditsTotal: 5, amountPaid: 0, stripePaymentIntentId: null })
    expect(sentTo(a)).toHaveLength(1)
  })

  it('keeps pass admin to admins', async () => {
    await expect((passAdminPost as Handler)(ev({ userId: editorId, body: { action: 'grant', passId, name: 'D', email: email('x') } }))).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('someone\'s own list', () => {
  it('needs the signed link, and shows only that address', async () => {
    const id = await seedClass()
    const a = email('a')
    await bookAndPay(id, a)
    await seedHolding(a, 5, { creditsUsed: 1 })
    await bookAndPay(id, email('someone-else'))

    const expires = Date.now() + 60_000
    const token = await bookingAccessToken(SITE, a, expires)
    const list = await (bookingsPost as Handler)(ev({ body: { action: 'list', email: a, expires, token } })) as { bookings: Array<{ status: string; cancelUrl: string }>; passes: Array<{ creditsLeft: number }> }
    expect(list.bookings).toHaveLength(1)
    expect(list.bookings[0]!.cancelUrl).toContain('/rsvp/cancel')
    expect(list.passes[0]!.creditsLeft).toBe(4)

    const someoneElse = email('someone-else')
    await expect((bookingsPost as Handler)(ev({ body: { action: 'list', email: someoneElse, expires, token } }))).rejects.toMatchObject({ statusCode: 403 })
    const old = Date.now() - 1000
    await expect((bookingsPost as Handler)(ev({ body: { action: 'list', email: a, expires: old, token: await bookingAccessToken(SITE, a, old) } }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('only emails a link when there is something to see, and answers the same either way', async () => {
    const empty = email('empty')
    expect(await (bookingsPost as Handler)(ev({ body: { action: 'send-link', email: empty } }))).toEqual({ sent: true })
    expect(sentTo(empty)).toHaveLength(0)

    const a = email('a')
    await seedHolding(a)
    expect(await (bookingsPost as Handler)(ev({ body: { action: 'send-link', email: a } }))).toEqual({ sent: true })
    expect(sentTo(a)).toHaveLength(1)
  })

  it('rejects a link token from another site', async () => {
    const id = await seedClass()
    const a = email('a')
    await bookAndPay(id, a)
    const r = await row(id, a)
    await expect(link('cancel', r.id, await rsvpToken('cancel', OTHER, r.id))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('won\'t let a pay link cancel, or a cancel link pay', async () => {
    const id = await seedClass()
    const a = email('a')
    await bookAndPay(id, a)
    const r = await row(id, a)
    await expect(link('cancel', r.id, await rsvpToken('pay', SITE, r.id))).rejects.toMatchObject({ statusCode: 404 })
    await expect(link('pay', r.id, await rsvpToken('cancel', SITE, r.id), 'card')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('reminders', () => {
  it('sends one the day before, once, and not to anyone cancelled', async () => {
    const id = await seedClass({ eventStartAt: inDays(1, 'T00:00:00.000Z'), eventEndAt: null, eventPrice: null })
    const a = email('a')
    const gone = email('gone')
    const start = new Date(Date.now() + 12 * 3_600_000).toISOString()
    await db().update(contentItems).set({ eventStartAt: start }).where(eq(contentItems.id, id))
    for (const address of [a, gone]) {
      await book(id, { email: address })
      await confirm(await row(id, address))
    }
    await cancel(await row(id, gone))
    mockSend.mockClear()

    const first = await sweepEventBookings()
    expect(first.reminded).toBeGreaterThanOrEqual(1)
    expect(lastSubject(a)).toContain('Reminder')
    expect(sentTo(gone)).toHaveLength(0)

    mockSend.mockClear()
    await sweepEventBookings()
    expect(sentTo(a)).toHaveLength(0)
  })

  it('leaves dates further off for later', async () => {
    const id = await seedClass({ eventPrice: null })
    const a = email('a')
    await book(id, { email: a })
    await confirm(await row(id, a))
    mockSend.mockClear()
    await sweepEventBookings()
    expect(sentTo(a)).toHaveLength(0)
  })
})

describe('admin list', () => {
  it('filters by date and exports payment details', async () => {
    const id = await seedClass({ eventStartAt: inDays(-7), eventEndAt: null, eventRecurrence: { freq: 'daily', interval: 7 } })
    const date = addDays(today, 7)
    const a = email('a')
    await bookAndPay(id, a, date)
    await bookAndPay(id, email('b'), addDays(today, 14))

    const list = await (listRsvps as Handler)(ev({ userId: editorId, query: { event: id, date } })) as { rsvps: Row[]; counts: { confirmed: number }; dates: Array<{ date: string }> }
    expect(list.rsvps.map(r => r.email)).toEqual([a])
    expect(list.counts.confirmed).toBe(1)
    expect(list.dates.map(d => d.date)).toContain(date)

    const csv = await (listRsvps as Handler)(ev({ userId: editorId, query: { event: id, date, format: 'csv' } })) as string
    expect(csv).toContain('paid_by')
    expect(csv).toContain(`"${a}","1","confirmed","${date}","card","paid","12","GBP"`)
  })

  it('adds a phone booking to the chosen date', async () => {
    const id = await seedClass({ eventStartAt: inDays(-7), eventEndAt: null, eventRecurrence: { freq: 'daily', interval: 7 } })
    const date = addDays(today, 7)
    const a = email('phone')
    await (addOrCancel as Handler)(ev({ userId: editorId, body: { action: 'add', event: id, date, name: 'P', email: a } }))
    expect(await row(id, a, date)).toMatchObject({ status: 'confirmed', paymentMethod: null })
  })
})

describe('one-time membership tiers', () => {
  it('checks out in payment mode, and grants access with no subscription behind it', async () => {
    const userId = await seedUser(db(), { email: 'once@book.test' })
    const tierId = await seedTier(db(), SITE, { name: 'Lifetime', price: 100, interval: 'one_time', stripePriceId: 'price_once' })
    await seedRole(db(), userId, SITE, 'member')

    const result = await (checkoutTier as Handler)(createMockEvent({
      siteId: SITE,
      session: { user: { id: userId, name: 'O', email: 'once@book.test' } },
      body: { tierId, returnUrl: 'http://book.localhost/members' },
      method: 'POST',
      headers: { host: 'book.localhost' },
    }) as unknown as H3Event) as { url: string }
    expect(result.url).toContain('checkout.stripe.test')
    expect(stripe.createPaymentCheckout).toHaveBeenCalledWith(expect.objectContaining({ priceId: 'price_once', metadata: expect.objectContaining({ nuxflowKind: 'tier', userId, siteId: SITE, tierId }) }))

    const session = { id: 'cs_once', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_once', amount_total: 10000, currency: 'gbp', metadata: { userId, siteId: SITE, tierId } }
    expect(await handleOneOffCheckoutCompleted(ev(), session)).toBe(true)
    await handleOneOffCheckoutCompleted(ev(), session)

    const rows = await db().query.subscriptions.findMany({ where: eq(subscriptions.userId, userId) })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'active', tierId })
    expect(rows[0]!.providerSubscriptionId.startsWith('free_')).toBe(true)
  })

  it('leaves subscription checkouts to the subscription code', async () => {
    const session = { id: 'cs_sub', mode: 'subscription', metadata: { userId: 'u', siteId: SITE, tierId: 't' } }
    expect(await handleOneOffCheckoutCompleted(ev(), session)).toBe(false)
  })
})
