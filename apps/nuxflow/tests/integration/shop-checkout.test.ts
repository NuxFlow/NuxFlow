/**
 * The basket and checkout (Stage 2 of the shop): prices and stock checked again on the
 * server, stock taken while the visitor pays so the last one can't be sold twice, given back
 * when they don't, late payments, the receipt, the customer's own order link and downloads.
 * Stripe is the only thing not real here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import type * as SettingsModule from '../../server/utils/settings'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { orderLines, orders, productVariants } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/edge-cache', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  purgeContentCache: vi.fn().mockResolvedValue(undefined),
  purgeAllPublicPages: vi.fn().mockResolvedValue(undefined),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))
vi.mock('../../server/utils/embeddings', () => ({
  upsertContentEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteContentEmbedding: vi.fn().mockResolvedValue(undefined),
}))

const { mockSend, stripe } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ messageId: 'm-1' }),
  stripe: { createOrderCheckout: vi.fn(), refundPayment: vi.fn(), getCheckoutSession: vi.fn(), expireCheckoutSession: vi.fn() },
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

const { default: shopPost } = await import('../../server/api/v1/shop/index.post')
const { default: createContent } = await import('../../server/api/v1/content/index.post')
const { default: publicShopPost } = await import('../../server/api/public/shop/index.post')
const { default: publicShopGet } = await import('../../server/api/public/shop/index.get')
const { handleOneOffCheckoutCompleted, handleOneOffCheckoutExpired, handleChargeRefunded } = await import('../../server/utils/booking-webhooks')
const { sweepShopHolds } = await import('../../server/scheduled/shop-holds')
const { orderToken, releaseOrderStock } = await import('../../server/utils/shop-checkout')
const { downloadToken, serveDownload, uploadVariantFile } = await import('../../server/utils/shop-downloads')
const { default: ordersPost } = await import('../../server/api/v1/orders/index.post')

type Handler = (e: H3Event) => Promise<unknown>
type Order = typeof orders.$inferSelect

const SITE = 'site-checkout-01'
let adminId: string
let seq = 0

const db = () => getCurrentTestDb()

// A media bucket in memory, for download files.
const files = new Map<string, { data: Uint8Array; meta?: { httpMetadata?: { contentType?: string; contentDisposition?: string } } }>()
const bucket = {
  put: vi.fn(async (key: string, data: Uint8Array, meta?: { httpMetadata?: { contentType?: string; contentDisposition?: string } }) => { files.set(key, { data, meta }) }),
  get: vi.fn(async (key: string) => {
    const f = files.get(key)
    if (!f) return null
    return {
      size: f.data.byteLength,
      body: new ReadableStream({ start(c) { c.enqueue(f.data); c.close() } }),
      writeHttpMetadata(h: Headers) {
        h.set('Content-Type', f.meta?.httpMetadata?.contentType ?? 'application/octet-stream')
        if (f.meta?.httpMetadata?.contentDisposition) h.set('Content-Disposition', f.meta.httpMetadata.contentDisposition)
      },
    }
  }),
  delete: vi.fn(async (keys: string | string[]) => { for (const k of [keys].flat()) files.delete(k) }),
}

function ev(opts: { userId?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string>; method?: string } = {}) {
  const event = createMockEvent({
    siteId: SITE,
    session: opts.userId ? { user: { id: opts.userId, name: 'U', email: 'u@checkout.test' } } : undefined,
    body: opts.body,
    params: opts.params,
    query: opts.query,
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { host: 'checkout.localhost', 'cf-connecting-ip': '203.0.113.5' },
  }) as unknown as { context: Record<string, unknown> }
  event.context.cloudflare = { env: { MEDIA_BUCKET: bucket }, context: { waitUntil: (p: Promise<unknown>) => { void p.catch(() => null) } } }
  return event as unknown as H3Event
}

interface VariantIn { stock?: number | null; priceMinor?: number; kind?: 'physical' | 'digital'; options?: string[] }

/** A published product with the given variants; returns their ids. */
async function product(variants: VariantIn[], optionNames: string[] = []) {
  const vs = variants.map(v => ({ id: ulid(), sku: null, options: v.options ?? [], priceMinor: v.priceMinor ?? 1000, compareAtMinor: null, stock: v.stock === undefined ? 5 : v.stock, weightGrams: null, kind: v.kind ?? 'physical', imageUrl: null, isActive: true }))
  const { id } = await (createContent as Handler)(ev({ userId: adminId, body: { title: `Thing ${++seq}`, slug: `thing-${seq}`, typeSlug: 'product', status: 'published', product: { optionNames, images: [], variants: vs } } })) as { id: string }
  return { id, variantIds: vs.map(v => v.id) }
}

const quote = (lines: { variantId: string; quantity: number }[]) => (publicShopPost as Handler)(ev({ body: { action: 'quote', lines } })) as Promise<{ lines: { variantId: string; problem: string | null }[]; subtotal: string; shipping: string | null; subtotalMinor: number; shippingMinor: number }>
const checkout = (lines: { variantId: string; quantity: number }[], extra: Record<string, unknown> = {}) => (publicShopPost as Handler)(ev({ body: { action: 'checkout', lines, ...extra } })) as Promise<{ url: string; orderId: string }>
const stockOf = async (variantId: string) => (await db().query.productVariants.findFirst({ where: eq(productVariants.id, variantId) }))?.stock
const getOrder = async (id: string) => (await db().query.orders.findFirst({ where: eq(orders.id, id) })) as Order
const linesOf = (orderId: string) => db().query.orderLines.findMany({ where: eq(orderLines.orderId, orderId) })

function paidSession(order: Order, over: Record<string, unknown> = {}) {
  return {
    id: order.stripeSessionId!,
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: `pi_${order.id}`,
    amount_total: order.totalMinor + 250,
    currency: order.currency.toLowerCase(),
    metadata: { nuxflowKind: 'order', siteId: SITE, orderId: order.id },
    total_details: { amount_tax: 250, amount_shipping: order.shippingMinor },
    customer_details: { email: 'Buyer@Example.test', name: 'Bea Buyer' },
    collected_information: { shipping_details: { name: 'Bea Buyer', address: { line1: '1 High St', city: 'Leeds', postal_code: 'LS1 1AA', country: 'GB' } } },
    ...over,
  }
}

const sentTo = (address: string) => mockSend.mock.calls.filter(c => JSON.stringify(c).includes(address))

beforeAll(async () => {
  await initTestDb()
  await seedSite(db(), { id: SITE, domain: 'checkout.localhost' })
  adminId = await seedUser(db(), { email: 'admin@checkout.test' })
  await seedRole(db(), adminId, SITE, 'admin')
  await seedSetting(db(), SITE, 'email.provider', 'resend')
  await seedSetting(db(), SITE, 'email.resend_api_key', 're_test_key')
  await (shopPost as Handler)(ev({ userId: adminId, body: { action: 'settings', enabled: true, config: { shippingCountries: ['GB', 'US'], shippingRateMinor: 395, freeShippingOverMinor: 5000, stripeTax: true, pricesIncludeTax: true } } }))
})

afterAll(teardownTestDb)

beforeEach(() => {
  mockSend.mockClear()
  stripe.createOrderCheckout.mockReset()
  stripe.refundPayment.mockReset()
  stripe.createOrderCheckout.mockImplementation(async () => ({ id: `cs_${++seq}`, url: `https://checkout.stripe.test/${seq}` }))
  stripe.refundPayment.mockImplementation(async () => ({ id: `re_${++seq}` }))
  stripe.getCheckoutSession.mockReset().mockResolvedValue({ id: 'cs', status: 'open' })
  stripe.expireCheckoutSession.mockReset().mockResolvedValue({})
})

describe('the basket', () => {
  it('is priced from the shop, with delivery, and free delivery over the threshold', async () => {
    const { variantIds: [a] } = await product([{ priceMinor: 1200 }])
    const small = await quote([{ variantId: a!, quantity: 2 }])
    expect(small).toMatchObject({ subtotal: '£24.00', shipping: '£3.95', subtotalMinor: 2400, shippingMinor: 395 })
    const big = await quote([{ variantId: a!, quantity: 5 }])
    expect(big).toMatchObject({ subtotalMinor: 6000, shippingMinor: 0, shipping: 'Free' })
  })

  it('says what can\'t be had, line by line', async () => {
    const { variantIds: [few] } = await product([{ stock: 1 }])
    const { variantIds: [gone] } = await product([{ stock: 0 }])
    const { variantIds: [file] } = await product([{ kind: 'digital', stock: null }])
    const result = await quote([{ variantId: few!, quantity: 3 }, { variantId: gone!, quantity: 1 }, { variantId: file!, quantity: 1 }, { variantId: ulid(), quantity: 1 }])
    expect(result.lines.map(l => l.problem)).toEqual(['Only 1 left.', 'Sold out.', 'This download isn\'t ready yet.', 'This isn\'t on sale any more.'])
  })
})

describe('checkout', () => {
  it('takes the stock and sends the basket to Stripe, with delivery and tax', async () => {
    const { variantIds: [a] } = await product([{ priceMinor: 1500, stock: 4 }])
    const { url, orderId } = await checkout([{ variantId: a!, quantity: 3 }], { email: 'Me@Example.test' })
    expect(url).toContain('checkout.stripe.test')
    expect(await stockOf(a!)).toBe(1)

    const order = await getOrder(orderId)
    expect(order).toMatchObject({ status: 'pending', email: 'me@example.test', subtotalMinor: 4500, shippingMinor: 395, totalMinor: 4895 })
    expect(Date.parse(order.holdExpiresAt!)).toBeGreaterThan(Date.now() + 30 * 60_000)
    expect(await linesOf(orderId)).toEqual([expect.objectContaining({ kind: 'product', refId: a, quantity: 3, stockTaken: 3, isDigital: false })])

    const args = stripe.createOrderCheckout.mock.calls[0]![0]
    expect(args).toMatchObject({
      currency: 'GBP',
      lines: [{ unitMinor: 1500, quantity: 3 }],
      shipping: { countries: ['GB', 'US'], amountMinor: 395 },
      automaticTax: true,
      pricesIncludeTax: true,
      metadata: { nuxflowKind: 'order', siteId: SITE, orderId },
    })
    expect(args.expiresInMinutes).toBeGreaterThanOrEqual(30)
  })

  it('can\'t sell the last one twice', async () => {
    const { variantIds: [a] } = await product([{ stock: 1 }])
    await checkout([{ variantId: a!, quantity: 1 }])
    await expect(checkout([{ variantId: a!, quantity: 1 }])).rejects.toMatchObject({ statusCode: 409 })
    expect(await stockOf(a!)).toBe(0)
    expect(stripe.createOrderCheckout).toHaveBeenCalledTimes(1)
  })

  it('gives the stock back and leaves no order when Stripe can\'t be reached', async () => {
    const { variantIds: [a] } = await product([{ stock: 2 }])
    stripe.createOrderCheckout.mockRejectedValueOnce(new Error('down'))
    await expect(checkout([{ variantId: a!, quantity: 2 }])).rejects.toMatchObject({ statusCode: 502 })
    expect(await stockOf(a!)).toBe(2)
    const left = await db().select().from(orderLines).where(and(eq(orderLines.siteId, SITE), eq(orderLines.refId, a!)))
    expect(left).toHaveLength(0)
  })

  it('lets a second try replace the first, so a visitor isn\'t short of their own stock', async () => {
    const { variantIds: [a] } = await product([{ stock: 1 }])
    const first = await checkout([{ variantId: a!, quantity: 1 }]) as { orderId: string; token: string }
    const second = await checkout([{ variantId: a!, quantity: 1 }], { previous: { orderId: first.orderId, token: first.token } })
    expect(stripe.expireCheckoutSession).toHaveBeenCalledTimes(1)
    expect((await getOrder(first.orderId)).status).toBe('expired')
    expect((await getOrder(second.orderId)).status).toBe('pending')
    expect(await stockOf(a!)).toBe(0)
  })

  it('refuses a second order when the first was paid after all', async () => {
    const { variantIds: [a] } = await product([{ stock: 5 }])
    const first = await checkout([{ variantId: a!, quantity: 1 }]) as { orderId: string; token: string }
    stripe.getCheckoutSession.mockResolvedValue({ id: 'cs', status: 'complete' })
    await expect(checkout([{ variantId: a!, quantity: 1 }], { previous: first })).rejects.toMatchObject({ statusCode: 409, data: { code: 'already_paid' } })
    // A made-up token is ignored rather than trusted.
    stripe.getCheckoutSession.mockResolvedValue({ id: 'cs', status: 'open' })
    await checkout([{ variantId: a!, quantity: 1 }], { previous: { orderId: first.orderId, token: 'b'.repeat(64) } })
    expect((await getOrder(first.orderId)).status).toBe('pending')
  })

  it('never tells visitors the exact stock', async () => {
    const { variantIds: [a] } = await product([{ stock: 40 }])
    const result = await quote([{ variantId: a!, quantity: 1 }])
    expect(result.lines[0]).not.toHaveProperty('stock')
  })

  it('needs no address for downloads alone, and never runs them out', async () => {
    const { variantIds: [d] } = await product([{ kind: 'digital', stock: null, priceMinor: 800 }])
    await uploadVariantFile(ev({ userId: adminId }), d!, { name: 'guide.pdf', type: 'application/pdf', data: new TextEncoder().encode('%PDF-1') })
    await checkout([{ variantId: d!, quantity: 1 }])
    expect(stripe.createOrderCheckout.mock.calls[0]![0]).toMatchObject({ shipping: null })
  })

  it('asks for the returns policy to be accepted when the shop has one', async () => {
    const { variantIds: [a] } = await product([{}])
    await (shopPost as Handler)(ev({ userId: adminId, body: { action: 'settings', config: { returnsPage: 'returns' } } }))
    await expect(checkout([{ variantId: a!, quantity: 1 }])).rejects.toMatchObject({ statusCode: 422 })
    const { orderId } = await checkout([{ variantId: a!, quantity: 1 }], { acceptedTerms: true })
    expect((await getOrder(orderId)).termsAcceptedAt).toBeTruthy()
    await (shopPost as Handler)(ev({ userId: adminId, body: { action: 'settings', config: { returnsPage: '' } } }))
  })
})

describe('after Stripe', () => {
  async function pending(stock = 3, quantity = 1) {
    const { variantIds: [a] } = await product([{ stock }])
    const { orderId } = await checkout([{ variantId: a!, quantity }])
    return { variantId: a!, order: await getOrder(orderId) }
  }

  it('marks the order paid with the address, once, and sends one receipt', async () => {
    const { order, variantId } = await pending(3, 2)
    await handleOneOffCheckoutCompleted(ev(), paidSession(order))
    const paid = await getOrder(order.id)
    expect(paid).toMatchObject({ status: 'paid', email: 'buyer@example.test', taxMinor: 250, holdExpiresAt: null })
    expect(paid.shippingAddress).toMatchObject({ line1: '1 High St', city: 'Leeds', country: 'GB' })
    expect(sentTo('buyer@example.test')).toHaveLength(1)
    expect(await stockOf(variantId)).toBe(1)

    await handleOneOffCheckoutCompleted(ev(), paidSession(order))
    expect(sentTo('buyer@example.test')).toHaveLength(1)
    expect(await stockOf(variantId)).toBe(1)
  })

  it('gives the stock back when the checkout expires', async () => {
    const { order, variantId } = await pending(3, 2)
    await handleOneOffCheckoutExpired(ev(), paidSession(order))
    expect((await getOrder(order.id)).status).toBe('expired')
    expect(await stockOf(variantId)).toBe(3)
    // A second expiry notice changes nothing.
    await handleOneOffCheckoutExpired(ev(), paidSession(order))
    expect(await stockOf(variantId)).toBe(3)
  })

  it('sweeps up holds whose time has run out, and leaves paid orders alone', async () => {
    const lapsed = await pending(3, 1)
    const paid = await pending(3, 1)
    await handleOneOffCheckoutCompleted(ev(), paidSession(paid.order))
    const past = new Date(Date.now() - 60_000).toISOString()
    await db().update(orders).set({ holdExpiresAt: past }).where(eq(orders.id, lapsed.order.id))
    await db().update(orders).set({ holdExpiresAt: past }).where(eq(orders.id, paid.order.id))

    await sweepShopHolds()
    expect((await getOrder(lapsed.order.id)).status).toBe('expired')
    expect(await stockOf(lapsed.variantId)).toBe(3)
    expect((await getOrder(paid.order.id)).status).toBe('paid')
    expect(await stockOf(paid.variantId)).toBe(2)
  })

  it('takes the stock again for a payment that lands after it went back', async () => {
    const { order, variantId } = await pending(3, 1)
    await handleOneOffCheckoutExpired(ev(), paidSession(order))
    await handleOneOffCheckoutCompleted(ev(), paidSession(order))
    expect((await getOrder(order.id)).status).toBe('paid')
    expect(await stockOf(variantId)).toBe(2)
    expect(stripe.refundPayment).not.toHaveBeenCalled()
  })

  it('refunds a late payment when it has sold out meanwhile, and says so', async () => {
    const { order, variantId } = await pending(1, 1)
    await handleOneOffCheckoutExpired(ev(), paidSession(order))
    await checkout([{ variantId, quantity: 1 }])
    await handleOneOffCheckoutCompleted(ev(), paidSession(order))
    expect(stripe.refundPayment).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: `pi_${order.id}`, idempotencyKey: `order-nostock-${order.id}` }))
    expect((await getOrder(order.id)).status).toBe('refunded')
    expect(await stockOf(variantId)).toBe(0)
    const subjects = sentTo('buyer@example.test').map(c => (c[1] as { subject: string }).subject)
    expect(subjects.at(-1)).toContain('couldn\'t be completed')
  })

  it('never gives back stock a payment has already claimed', async () => {
    const { order, variantId } = await pending(3, 1)
    // The sweep marks it expired, then the payment lands before the stock is let go.
    await db().update(orders).set({ status: 'expired' }).where(eq(orders.id, order.id))
    await handleOneOffCheckoutCompleted(ev(), paidSession(order))
    await releaseOrderStock(db(), SITE, order.id)
    expect((await getOrder(order.id)).status).toBe('paid')
    expect(await stockOf(variantId)).toBe(2)
  })

  it('follows a refund made in Stripe\'s dashboard', async () => {
    const { order } = await pending(3, 1)
    await handleOneOffCheckoutCompleted(ev(), paidSession(order))
    const paid = await getOrder(order.id)
    await handleChargeRefunded(ev(), { payment_intent: paid.stripePaymentIntentId, amount: paid.totalMinor, amount_refunded: paid.totalMinor, currency: 'gbp' })
    expect((await getOrder(order.id)).status).toBe('refunded')
  })
})

describe('the customer\'s own order and downloads', () => {
  async function paidDownload() {
    const { variantIds: [d] } = await product([{ kind: 'digital', stock: null, priceMinor: 900 }])
    await uploadVariantFile(ev({ userId: adminId }), d!, { name: 'Pattern book.pdf', type: 'application/pdf', data: new TextEncoder().encode('%PDF-pattern') })
    const { orderId } = await checkout([{ variantId: d!, quantity: 1 }])
    await handleOneOffCheckoutCompleted(ev(), paidSession(await getOrder(orderId), { collected_information: null }))
    const [line] = await linesOf(orderId)
    return { orderId, lineId: line!.id }
  }

  it('shows the order only with its signed link, with a download once paid', async () => {
    const { orderId } = await paidDownload()
    await expect((publicShopGet as Handler)(ev({ query: { order: orderId, token: 'f'.repeat(64) } }))).rejects.toMatchObject({ statusCode: 404 })
    const { order } = await (publicShopGet as Handler)(ev({ query: { order: orderId, token: await orderToken(SITE, orderId) } })) as { order: { status: string; lines: { download: { url: string; left: number; available: boolean } | null }[] } }
    expect(order.status).toBe('paid')
    expect(order.lines[0]!.download).toMatchObject({ left: 5, available: true })
    expect(order.lines[0]!.download!.url).toContain('/_nuxflow/download/')
  })

  it('serves the file a limited number of times', async () => {
    const { lineId } = await paidDownload()
    const token = await downloadToken(SITE, lineId)
    const res = await serveDownload(ev(), lineId, token)
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    expect(await res.text()).toBe('%PDF-pattern')
    await db().update(orderLines).set({ downloads: 5 }).where(eq(orderLines.id, lineId))
    await expect(serveDownload(ev(), lineId, token)).rejects.toMatchObject({ statusCode: 410 })
    await expect(serveDownload(ev(), lineId, 'a'.repeat(64))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('stops working once the order is refunded', async () => {
    const { orderId, lineId } = await paidDownload()
    await (ordersPost as Handler)(ev({ userId: adminId, body: { action: 'refund', id: orderId } }))
    await expect(serveDownload(ev(), lineId, await downloadToken(SITE, lineId))).rejects.toMatchObject({ statusCode: 410 })
  })

  it('keeps files out of the public part of the bucket, and replaces the old one', async () => {
    const { variantIds: [d] } = await product([{ kind: 'digital', stock: null }])
    await uploadVariantFile(ev({ userId: adminId }), d!, { name: 'one.zip', data: new Uint8Array([1]) })
    const first = (await db().query.productVariants.findFirst({ where: eq(productVariants.id, d!) }))!.fileKey!
    expect(first.startsWith(`_private/${SITE}/shop/${d}/`)).toBe(true)
    await uploadVariantFile(ev({ userId: adminId }), d!, { name: 'two.zip', data: new Uint8Array([2, 2]) })
    expect(files.has(first)).toBe(false)
    expect(await db().query.productVariants.findFirst({ where: eq(productVariants.id, d!) })).toMatchObject({ fileName: 'two.zip', fileSize: 2 })
  })
})
