/**
 * Orders: every one-off payment (bookings, class passes, one-time tiers) has one, marked paid
 * by the webhook, and money goes back through one refund path, from the Orders page, from
 * the booking code, or from Stripe's own dashboard, without counting anything twice.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import type * as SettingsModule from '../../server/utils/settings'
import { and, eq } from 'drizzle-orm'
import { addDays } from '@nuxflow/canvas/events'
import { classPasses, classPassHoldings, eventRsvps, orderLines, orderRefunds, orders, subscriptions } from '@nuxflow/db/schema'
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
vi.mock('../../server/utils/settings', async (importOriginal) => {
  const original = await importOriginal<typeof SettingsModule>()
  return {
    ...original,
    resolveStringSetting: async (event: H3Event, key: string, envKey?: string) => {
      if (key === 'payments.stripe_secret_key' || key === 'payments.stripe_webhook_secret') return 'configured'
      return original.resolveStringSetting(event, key, envKey)
    },
  }
})

const { default: rsvpPost } = await import('../../server/api/public/rsvp/[id].post')
const { default: passBuy } = await import('../../server/api/public/class-passes/index.post')
const { default: checkoutTier } = await import('../../server/api/v1/memberships/checkout.post')
const { default: ordersGet } = await import('../../server/api/v1/orders/index.get')
const { default: ordersPost } = await import('../../server/api/v1/orders/index.post')
const { handleChargeRefunded, handleOneOffCheckoutCompleted, handleOneOffCheckoutExpired } = await import('../../server/utils/booking-webhooks')

type Handler = (e: H3Event) => Promise<unknown>
type Order = typeof orders.$inferSelect

const SITE = 'site-orders-01'
const OTHER = 'site-orders-02'

let adminId: string
let editorId: string
let eventType: string
let seq = 0

const db = () => getCurrentTestDb()
const today = new Date().toISOString().slice(0, 10)
const email = (name: string) => `${name}-${++seq}@buyers.test`

function ev(opts: { userId?: string; siteId?: string; body?: unknown; query?: Record<string, string>; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: opts.userId ? { user: { id: opts.userId, name: 'U', email: 'staff@orders.test' } } : undefined,
    body: opts.body,
    params: opts.params,
    query: opts.query,
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: { host: 'orders.localhost', 'cf-connecting-ip': '203.0.113.7' },
  }) as unknown as H3Event
}

async function seedClass(siteId = SITE) {
  return seedContentItem(db(), siteId, eventType, {
    title: 'Pottery',
    slug: `pottery-${++seq}`,
    status: 'published',
    visibility: 'public',
    eventStartAt: `${addDays(today, 10)}T18:00:00.000Z`,
    eventRsvpEnabled: true,
    eventPrice: 12.5,
    eventCurrency: 'GBP',
  })
}

/** Books by card and returns the pending order and the checkout's metadata. */
async function startBooking(seats = 2) {
  const itemId = await seedClass()
  const address = email('a')
  const answer = await (rsvpPost as Handler)(ev({ params: { id: itemId }, body: { name: 'Ann', email: address, seats } })) as { status: string }
  expect(answer.status).toBe('checkout')
  const call = stripe.createPaymentCheckout.mock.calls.at(-1)![0] as { metadata: Record<string, string> }
  const sessionId = (await stripe.createPaymentCheckout.mock.results.at(-1)!.value as { id: string }).id
  const order = (await db().query.orders.findFirst({ where: eq(orders.id, call.metadata.orderId!) }))!
  return { itemId, address, order, metadata: call.metadata, sessionId }
}

const paid = (sessionId: string, metadata: Record<string, string>, amount: number, over: Record<string, unknown> = {}) => ({
  id: sessionId,
  mode: 'payment',
  payment_status: 'paid',
  payment_intent: `pi_${sessionId}`,
  amount_total: amount,
  currency: 'gbp',
  metadata,
  total_details: { amount_tax: 0, amount_shipping: 0, amount_discount: 0 },
  ...over,
})

const getOrder = async (id: string) => (await db().query.orders.findFirst({ where: eq(orders.id, id) })) as Order
const refunds = (orderId: string) => db().query.orderRefunds.findMany({ where: eq(orderRefunds.orderId, orderId) })

beforeAll(async () => {
  await initTestDb()
  await seedSite(db(), { id: SITE, domain: 'orders.localhost', timezone: 'UTC' })
  await seedSite(db(), { id: OTHER, domain: 'other-orders.localhost', timezone: 'UTC' })
  adminId = await seedUser(db(), { email: 'admin@orders.test' })
  editorId = await seedUser(db(), { email: 'editor@orders.test' })
  await seedRole(db(), adminId, SITE, 'admin')
  await seedRole(db(), editorId, SITE, 'editor')
  eventType = await seedContentType(db(), SITE, { slug: 'event', name: 'Events', singularName: 'Event' })
  await seedSetting(db(), SITE, 'email.provider', 'resend')
  await seedSetting(db(), SITE, 'email.resend_api_key', 're_test_key')
  await db().insert(classPasses).values({ id: 'pass-ten', siteId: SITE, name: '10 classes', credits: 10, price: 90, currency: 'GBP' })
})

afterAll(teardownTestDb)

beforeEach(() => {
  mockSend.mockClear()
  for (const fn of Object.values(stripe)) fn.mockReset()
  let n = 0
  stripe.createPaymentCheckout.mockImplementation(async () => {
    n++
    return { id: `cs_${++seq}_${n}`, url: `https://checkout.stripe.test/${n}` }
  })
  stripe.getCheckoutSession.mockResolvedValue({ id: 'cs', status: 'open' })
  stripe.expireCheckoutSession.mockResolvedValue({})
  let r = 0
  stripe.refundPayment.mockImplementation(async () => ({ id: `re_${++seq}_${++r}` }))
  stripe.findCustomerForSite.mockResolvedValue({ id: 'cus_1' })
})

describe('an order for every payment', () => {
  it('makes a pending order before Stripe, with the booking as its line', async () => {
    const { order, metadata, sessionId } = await startBooking(2)
    expect(metadata).toMatchObject({ nuxflowKind: 'booking', siteId: SITE })
    expect(order).toMatchObject({ status: 'pending', currency: 'GBP', subtotalMinor: 2500, totalMinor: 2500, stripeSessionId: sessionId, name: 'Ann' })
    const lines = await db().query.orderLines.findMany({ where: eq(orderLines.orderId, order.id) })
    expect(lines).toEqual([expect.objectContaining({ kind: 'booking', quantity: 2, unitMinor: 1250, totalMinor: 2500, name: 'Pottery', recordId: metadata.rsvpId })])
  })

  it('numbers orders per site from 1001', async () => {
    const first = (await startBooking()).order
    const second = (await startBooking()).order
    expect(first.number).toBeGreaterThanOrEqual(1001)
    expect(second.number).toBe(first.number + 1)
  })

  it('is marked paid by the webhook, once, with what Stripe took', async () => {
    const { order, metadata, sessionId } = await startBooking(2)
    const session = paid(sessionId, metadata, 2700, { total_details: { amount_tax: 200 } })
    await handleOneOffCheckoutCompleted(ev(), session)
    const after = await getOrder(order.id)
    expect(after).toMatchObject({ status: 'paid', totalMinor: 2700, taxMinor: 200, stripePaymentIntentId: `pi_${sessionId}` })
    expect(after.paidAt).toBeTruthy()

    await handleOneOffCheckoutCompleted(ev(), session)
    expect((await getOrder(order.id)).paidAt).toBe(after.paidAt)
  })

  it('expires with its checkout', async () => {
    const { order, metadata, sessionId } = await startBooking()
    await handleOneOffCheckoutExpired(ev(), paid(sessionId, metadata, 0))
    expect((await getOrder(order.id)).status).toBe('expired')
  })

  it('isn\'t left behind when Stripe can\'t be reached', async () => {
    const before = (await db().query.orders.findMany({ where: eq(orders.siteId, SITE) })).length
    stripe.createPaymentCheckout.mockRejectedValueOnce(new Error('down'))
    const itemId = await seedClass()
    await expect((rsvpPost as Handler)(ev({ params: { id: itemId }, body: { name: 'B', email: email('b'), seats: 1 } }))).rejects.toThrow()
    expect((await db().query.orders.findMany({ where: eq(orders.siteId, SITE) })).length).toBe(before)
  })

  it('records a class pass, pointing at the holding it made', async () => {
    const address = email('pass')
    await (passBuy as Handler)(ev({ body: { passId: 'pass-ten', name: 'P', email: address } }))
    const { metadata } = stripe.createPaymentCheckout.mock.calls.at(-1)![0] as { metadata: Record<string, string> }
    expect(metadata.nuxflowKind).toBe('pass')
    await handleOneOffCheckoutCompleted(ev(), paid(`cs_pass_${++seq}`, metadata, 9000))
    const holding = await db().query.classPassHoldings.findFirst({ where: eq(classPassHoldings.email, address) })
    const [line] = await db().query.orderLines.findMany({ where: eq(orderLines.orderId, metadata.orderId!) })
    expect(line).toMatchObject({ kind: 'pass', recordId: holding!.id, unitMinor: 9000 })
    expect((await getOrder(metadata.orderId!)).status).toBe('paid')
  })

  it('records a payment from a checkout opened before orders existed', async () => {
    const address = email('legacy')
    const sessionId = `cs_legacy_${++seq}`
    await handleOneOffCheckoutCompleted(ev(), paid(sessionId, { nuxflowBooking: 'pass', siteId: SITE, passId: 'pass-ten', email: address, name: 'L' }, 9000))
    const order = await db().query.orders.findFirst({ where: and(eq(orders.siteId, SITE), eq(orders.stripeSessionId, sessionId)) })
    expect(order).toMatchObject({ status: 'paid', email: address, totalMinor: 9000 })
    const [line] = await db().query.orderLines.findMany({ where: eq(orderLines.orderId, order!.id) })
    expect(line).toMatchObject({ kind: 'pass', name: '10 classes' })
  })
})

describe('refunds', () => {
  async function paidBooking(seats = 2) {
    const started = await startBooking(seats)
    await handleOneOffCheckoutCompleted(ev(), paid(started.sessionId, started.metadata, 1250 * seats))
    return started
  }
  const refund = (id: string, body: Record<string, unknown> = {}) => (ordersPost as Handler)(ev({ userId: adminId, body: { action: 'refund', id, ...body } }))
  const rsvp = (id: string) => db().query.eventRsvps.findFirst({ where: eq(eventRsvps.id, id) })

  it('refunds part of an order, leaving the booking in place', async () => {
    const { order, metadata } = await paidBooking()
    await refund(order.id, { amountMinor: 500, reason: 'Late start' })
    expect(stripe.refundPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 5, currency: 'GBP', paymentIntentId: expect.stringContaining('pi_') }))
    expect(await getOrder(order.id)).toMatchObject({ status: 'partially_refunded', refundedMinor: 500 })
    expect(await refunds(order.id)).toEqual([expect.objectContaining({ amountMinor: 500, reason: 'Late start', createdBy: adminId })])
    expect((await rsvp(metadata.rsvpId!))?.status).toBe('confirmed')
  })

  it('refunds what is left in full, and cancels the booking', async () => {
    const { order, metadata } = await paidBooking()
    await refund(order.id, { amountMinor: 500 })
    await refund(order.id)
    // The second asks for the rest, not the whole payment again.
    expect(stripe.refundPayment.mock.calls.at(-1)![0]).toMatchObject({ amount: 20 })
    expect(await getOrder(order.id)).toMatchObject({ status: 'refunded', refundedMinor: 2500 })
    expect(await rsvp(metadata.rsvpId!)).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' })
    await expect(refund(order.id)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses more than is left, and orders nobody paid', async () => {
    const { order } = await paidBooking(1)
    await expect(refund(order.id, { amountMinor: 1251 })).rejects.toMatchObject({ statusCode: 422 })
    const pending = (await startBooking()).order
    await expect(refund(pending.id)).rejects.toMatchObject({ statusCode: 409 })
    expect(stripe.refundPayment).not.toHaveBeenCalled()
  })

  it('records nothing when Stripe refuses', async () => {
    const { order } = await paidBooking()
    stripe.refundPayment.mockRejectedValueOnce(new Error('insufficient balance'))
    await expect(refund(order.id)).rejects.toMatchObject({ statusCode: 502 })
    expect(await getOrder(order.id)).toMatchObject({ status: 'paid', refundedMinor: 0 })
  })

  it('records the booking code\'s own refunds against the order', async () => {
    const { order, metadata } = await paidBooking()
    const row = await rsvp(metadata.rsvpId!)
    const { setRsvpStatus } = await import('../../server/utils/event-rsvp')
    await setRsvpStatus(ev(), row!, 'cancelled', { refund: true })
    expect(await getOrder(order.id)).toMatchObject({ status: 'refunded', refundedMinor: 2500 })
  })

  it('counts a refund once, whether our record or Stripe\'s webhook comes first', async () => {
    const { order } = await paidBooking()
    const pi = (await getOrder(order.id)).stripePaymentIntentId
    await refund(order.id, { amountMinor: 1000 })
    await handleChargeRefunded(ev(), { payment_intent: pi, amount: 2500, amount_refunded: 1000, currency: 'gbp' })
    expect((await getOrder(order.id)).refundedMinor).toBe(1000)

    // Then 300 more from Stripe's dashboard.
    await handleChargeRefunded(ev(), { payment_intent: pi, amount: 2500, amount_refunded: 1300, currency: 'gbp' })
    const detail = await (ordersGet as Handler)(ev({ userId: adminId, query: { id: order.id } })) as { order: Order; refundedElsewhereMinor: number }
    expect(detail.order).toMatchObject({ refundedMinor: 1300, status: 'partially_refunded' })
    expect(detail.refundedElsewhereMinor).toBe(300)
  })

  it('ends one-time membership access refunded in full', async () => {
    const userId = await seedUser(db(), { email: `lifetime-${++seq}@orders.test` })
    await seedRole(db(), userId, SITE, 'member')
    const tierId = await seedTier(db(), SITE, { name: 'Lifetime', price: 100, interval: 'one_time', stripePriceId: 'price_life' })
    await (checkoutTier as Handler)(createMockEvent({
      siteId: SITE,
      session: { user: { id: userId, name: 'L', email: 'l@orders.test' } },
      body: { tierId, returnUrl: 'http://orders.localhost/members' },
      method: 'POST',
      headers: { host: 'orders.localhost' },
    }) as unknown as H3Event)
    const { metadata } = stripe.createPaymentCheckout.mock.calls.at(-1)![0] as { metadata: Record<string, string> }
    await handleOneOffCheckoutCompleted(ev(), paid(`cs_life_${++seq}`, metadata, 10000))
    const order = await getOrder(metadata.orderId!)
    expect(order).toMatchObject({ status: 'paid', userId })

    await refund(order.id)
    const [sub] = await db().query.subscriptions.findMany({ where: and(eq(subscriptions.userId, userId), eq(subscriptions.siteId, SITE)) })
    expect(sub?.status).toBe('cancelled')
  })
})

describe('the Orders page', () => {
  it('lists sales by default, filters, and finds an order by number', async () => {
    const pending = (await startBooking()).order
    const paidOne = await startBooking()
    await handleOneOffCheckoutCompleted(ev(), paid(paidOne.sessionId, paidOne.metadata, 2500))

    const sales = await (ordersGet as Handler)(ev({ userId: adminId })) as { orders: Order[] }
    expect(sales.orders.map(o => o.id)).toContain(paidOne.order.id)
    expect(sales.orders.map(o => o.id)).not.toContain(pending.id)

    const all = await (ordersGet as Handler)(ev({ userId: adminId, query: { filter: 'all', kind: 'booking' } })) as { orders: Order[] }
    expect(all.orders.map(o => o.id)).toContain(pending.id)
    const passes = await (ordersGet as Handler)(ev({ userId: adminId, query: { filter: 'all', kind: 'pass' } })) as { orders: Order[] }
    expect(passes.orders.map(o => o.id)).not.toContain(pending.id)

    const found = await (ordersGet as Handler)(ev({ userId: adminId, query: { filter: 'all', search: `#${pending.number}` } })) as { orders: Order[] }
    expect(found.orders.map(o => o.id)).toEqual([pending.id])
  })

  it('is for admins, and only shows this site\'s orders', async () => {
    await expect((ordersGet as Handler)(ev({ userId: editorId }))).rejects.toMatchObject({ statusCode: 403 })
    const { order } = await startBooking()
    await expect((ordersGet as Handler)(ev({ userId: adminId, siteId: OTHER, query: { id: order.id } }))).rejects.toMatchObject({ statusCode: 403 })
    const otherAdmin = await seedUser(db(), { email: `other-${++seq}@orders.test` })
    await seedRole(db(), otherAdmin, OTHER, 'admin')
    await expect((ordersGet as Handler)(ev({ userId: otherAdmin, siteId: OTHER, query: { id: order.id } }))).rejects.toMatchObject({ statusCode: 404 })
  })
})
