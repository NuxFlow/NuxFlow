/**
 * Unit tests for the payment provider adapters' outbound API calls. Integration tests
 * mock these classes wholesale, so the request shapes themselves were never checked.
 * Pinned here: end-of-period cancellation on all three providers (CLAUDE.md "Payments"),
 * smallest-currency-unit price conversion, and auth headers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { stripeCalls } = vi.hoisted(() => ({ stripeCalls: [] as { method: string; args: unknown[] }[] }))
vi.mock('stripe', () => {
  const rec = (method: string) => (...args: unknown[]) => { stripeCalls.push({ method, args }); return Promise.resolve({ id: 'x' }) }
  class FakeStripe {
    customers = { create: rec('customers.create'), list: async () => ({ data: [] }) }
    products = { create: rec('products.create'), update: rec('products.update') }
    prices = { create: rec('prices.create') }
    checkout = { sessions: { create: rec('checkout.sessions.create') } }
    billingPortal = { sessions: { create: rec('billingPortal.sessions.create') } }
    subscriptions = { update: rec('subscriptions.update'), cancel: rec('subscriptions.cancel'), retrieve: rec('subscriptions.retrieve') }
    webhooks = { constructEventAsync: rec('webhooks.constructEventAsync') }
  }
  return { default: FakeStripe }
})

globalThis.createError = ((o: { statusCode?: number; message?: string }) => Object.assign(new Error(o.message), o)) as never

const { StripeProvider, toStripeUnitAmount } = await import('../../server/utils/payments/stripe')
const { LemonSqueezyProvider } = await import('../../server/utils/payments/lemonsqueezy')
const { PaddleProvider } = await import('../../server/utils/payments/paddle')

describe('StripeProvider', () => {
  beforeEach(() => { stripeCalls.length = 0 })

  it('cancels at period end, never immediately', async () => {
    await new StripeProvider('sk_test').cancelSubscription('sub_1')
    expect(stripeCalls).toEqual([{ method: 'subscriptions.update', args: ['sub_1', { cancel_at_period_end: true }] }])
  })

  it.each([
    [9.99, 'usd', 999],
    [10, 'EUR', 1000],
    [0.1 + 0.2, 'gbp', 30],
    [1000, 'JPY', 1000],
    [5000, 'krw', 5000],
    [1.234, 'KWD', 1230],
  ])('converts %d %s to unit_amount %d', (amount, currency, expected) => {
    expect(toStripeUnitAmount(amount, currency)).toBe(expected)
  })

  it('creates recurring vs one-time prices with a lower-cased currency', async () => {
    const s = new StripeProvider('sk_test')
    await s.createPrice('prod_1', 1000, 'JPY', 'month')
    await s.createPrice('prod_1', 5, 'USD', 'one_time')
    expect(stripeCalls[0]!.args[0]).toEqual({ product: 'prod_1', unit_amount: 1000, currency: 'jpy', recurring: { interval: 'month' } })
    expect(stripeCalls[1]!.args[0]).toEqual({ product: 'prod_1', unit_amount: 500, currency: 'usd' })
  })

  it('propagates checkout metadata onto the subscription too (webhooks read it from there)', async () => {
    await new StripeProvider('sk').createCheckoutSession({ customerId: 'c', priceId: 'p', successUrl: 's', cancelUrl: 'x', metadata: { tierId: 't' } })
    expect(stripeCalls[0]!.args[0]).toMatchObject({ mode: 'subscription', metadata: { tierId: 't' }, subscription_data: { metadata: { tierId: 't' } } })
  })
})

describe('HTTP providers', () => {
  let calls: { url: string; init: RequestInit }[]
  const realFetch = globalThis.fetch
  beforeEach(() => {
    calls = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({ data: { id: 'sub_1', attributes: {} } }), { status: 200 })
    }) as typeof fetch
  })
  afterEach(() => { globalThis.fetch = realFetch })

  it('LemonSqueezy cancels via DELETE (its own end-of-period semantics) with bearer auth', async () => {
    await new LemonSqueezyProvider('ls_key', 'store_1').cancelSubscription('42')
    expect(calls[0]!.url).toBe('https://api.lemonsqueezy.com/v1/subscriptions/42')
    expect(calls[0]!.init.method).toBe('DELETE')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer ls_key')
  })

  it('Paddle cancels effective next billing period', async () => {
    await new PaddleProvider('pdl_key', 'ven_1').cancelSubscription('sub_9')
    expect(calls[0]!.url).toMatch(/\/subscriptions\/sub_9\/cancel$/)
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ effective_from: 'next_billing_period' })
  })

  it('surfaces a provider error status instead of treating it as success', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch
    await expect(new LemonSqueezyProvider('bad', 's').cancelSubscription('1')).rejects.toThrow(/401/)
  })
})
