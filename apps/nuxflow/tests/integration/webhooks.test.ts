import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedTier, seedSubscription, seedSetting } from '../helpers/seed'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import handler from '../../server/api/v1/memberships/webhooks/[provider].post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// Silence the push helper — setting is never seeded so it's a no-op anyway,
// but mocking avoids any import-time side effects from the webpush module.
vi.mock('../../server/utils/webpush', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))

const { mockConstructEvent, mockLsVerify, mockPaddleVerify } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
  mockLsVerify: vi.fn(),
  mockPaddleVerify: vi.fn(),
}))

vi.mock('../../server/utils/payments/stripe', () => ({
  StripeProvider: vi.fn().mockImplementation(function () {
    return { constructWebhookEvent: mockConstructEvent }
  }),
}))

vi.mock('../../server/utils/payments/lemonsqueezy', () => ({
  LemonSqueezyProvider: vi.fn().mockImplementation(function () {
    return { verifyWebhook: mockLsVerify }
  }),
}))

vi.mock('../../server/utils/payments/paddle', () => ({
  PaddleProvider: vi.fn().mockImplementation(function () {
    return { verifyWebhook: mockPaddleVerify }
  }),
}))

const SITE = 'site-webhooks-01'
let userId: string
let tierId: string
const STRIPE_PRICE_ID = 'price_wh_test_001'

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'webhooks.localhost' })
  userId = await seedUser(db, { email: 'wh-user@webhooks.test' })
  tierId = await seedTier(db, SITE, {
    name: 'Webhook Tier',
    price: 999,
    stripePriceId: STRIPE_PRICE_ID,
  })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(provider: string, rawBody: string, headers: Record<string, string> = {}) {
  return createMockEvent({
    siteId: SITE,
    params: { provider },
    rawBody,
    headers,
  }) as unknown as H3Event
}

// ── Unknown provider ──────────────────────────────────────────────────────────

describe('POST /api/v1/memberships/webhooks/:provider', () => {
  it('throws 400 for an unknown provider', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent('paypal', '{}')),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ── Stripe webhooks ───────────────────────────────────────────────────────────

describe('Stripe webhooks', () => {
  it('throws 503 when Stripe is not configured', async () => {
    // No stripe key seeded yet for this site
    await expect(
      (handler as HandlerFn)(mkEvent('stripe', '{}', { 'stripe-signature': 'sig' })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('throws 400 when the webhook signature is invalid', async () => {
    await seedSetting(getCurrentTestDb(), SITE, 'payments.stripe_secret_key', 'sk_test_wh')
    mockConstructEvent.mockImplementationOnce(() => { throw new Error('Invalid signature') })

    await expect(
      (handler as HandlerFn)(mkEvent('stripe', '{}', { 'stripe-signature': 'bad-sig' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('inserts a subscription on customer.subscription.created', async () => {
    const subId = 'sub_wh_created_001'
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: subId,
          customer: 'cus_wh_001',
          status: 'active',
          items: { data: [{ price: { id: STRIPE_PRICE_ID } }] },
          current_period_start: 1717286400,
          current_period_end: 1719878400,
          metadata: { userId },
        },
      },
    })

    const result = await (handler as HandlerFn)(
      mkEvent('stripe', '{}', { 'stripe-signature': 'valid-sig' }),
    ) as { received: boolean }

    expect(result.received).toBe(true)

    const db = getCurrentTestDb()
    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.providerSubscriptionId, subId), eq(subscriptions.provider, 'stripe')),
    })
    expect(sub).toBeDefined()
    expect(sub!.status).toBe('active')
    expect(sub!.tierId).toBe(tierId)
    expect(sub!.providerCustomerId).toBe('cus_wh_001')
  })

  it('updates an existing subscription on customer.subscription.updated', async () => {
    const subId = 'sub_wh_created_001' // same ID as above — already in DB
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: subId,
          customer: 'cus_wh_001',
          status: 'past_due',
          items: { data: [{ price: { id: STRIPE_PRICE_ID } }] },
          current_period_start: 1717286400,
          current_period_end: 1719878400,
          metadata: { userId },
        },
      },
    })

    await (handler as HandlerFn)(mkEvent('stripe', '{}', { 'stripe-signature': 'valid-sig' }))

    const db = getCurrentTestDb()
    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.providerSubscriptionId, subId), eq(subscriptions.provider, 'stripe')),
    })
    expect(sub!.status).toBe('past_due')
  })

  it('marks a subscription cancelled on customer.subscription.deleted', async () => {
    const subId = 'sub_wh_deleted_002'
    await seedSubscription(getCurrentTestDb(), SITE, userId, tierId, {
      providerSubscriptionId: subId,
      provider: 'stripe',
      status: 'active',
    })

    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.deleted',
      data: { object: { id: subId } },
    })

    await (handler as HandlerFn)(mkEvent('stripe', '{}', { 'stripe-signature': 'valid-sig' }))

    const db = getCurrentTestDb()
    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.providerSubscriptionId, subId), eq(subscriptions.provider, 'stripe')),
    })
    expect(sub!.status).toBe('cancelled')
    expect(sub!.cancelledAt).toBeTruthy()
  })

  it('silently ignores events with no userId in metadata', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_no_meta',
          customer: 'cus_x',
          status: 'active',
          items: { data: [{ price: { id: STRIPE_PRICE_ID } }] },
          current_period_start: 1717286400,
          current_period_end: 1719878400,
          metadata: {},
        },
      },
    })

    const result = await (handler as HandlerFn)(
      mkEvent('stripe', '{}', { 'stripe-signature': 'valid-sig' }),
    ) as { received: boolean }
    expect(result.received).toBe(true)
  })
})

// ── LemonSqueezy webhooks ─────────────────────────────────────────────────────

describe('LemonSqueezy webhooks', () => {
  it('throws 503 when LemonSqueezy is not configured', async () => {
    // ls_api_key and ls_store_id not seeded
    await expect(
      (handler as HandlerFn)(mkEvent('lemonsqueezy', '{}', { 'x-signature': 'sig' })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('throws 400 when the webhook signature is invalid', async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, SITE, 'payments.ls_api_key', 'ls_key_test')
    await seedSetting(db, SITE, 'payments.ls_store_id', '12345')
    mockLsVerify.mockResolvedValueOnce(false)

    await expect(
      (handler as HandlerFn)(mkEvent('lemonsqueezy', '{}', { 'x-signature': 'bad-sig' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('inserts a subscription on subscription_created', async () => {
    const lsSubId = 'ls_sub_001'
    const lsVariantId = 42
    const lsTierId = await seedTier(getCurrentTestDb(), SITE, {
      name: 'LS Tier',
      price: 500,
      lsVariantId: String(lsVariantId),
    })
    mockLsVerify.mockResolvedValueOnce(true)

    const rawBody = JSON.stringify({
      meta: {
        event_name: 'subscription_created',
        custom_data: { user_id: userId },
      },
      data: {
        id: lsSubId,
        attributes: {
          status: 'active',
          customer_id: 999,
          variant_id: lsVariantId,
          renews_at: '2025-01-01T00:00:00Z',
        },
      },
    })

    const result = await (handler as HandlerFn)(
      mkEvent('lemonsqueezy', rawBody, { 'x-signature': 'valid' }),
    ) as { received: boolean }
    expect(result.received).toBe(true)

    const db = getCurrentTestDb()
    const sub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.providerSubscriptionId, lsSubId),
        eq(subscriptions.provider, 'lemonsqueezy'),
      ),
    })
    expect(sub).toBeDefined()
    expect(sub!.status).toBe('active')
    expect(sub!.tierId).toBe(lsTierId)
  })
})

// ── Paddle webhooks ───────────────────────────────────────────────────────────

describe('Paddle webhooks', () => {
  it('throws 503 when Paddle is not configured', async () => {
    // paddle_api_key and paddle_vendor_id not seeded
    await expect(
      (handler as HandlerFn)(mkEvent('paddle', '{}', { 'paddle-signature': 'sig' })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('throws 400 when the webhook signature is invalid', async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, SITE, 'payments.paddle_api_key', 'pdl_key_test')
    await seedSetting(db, SITE, 'payments.paddle_vendor_id', '67890')
    mockPaddleVerify.mockResolvedValueOnce(false)

    await expect(
      (handler as HandlerFn)(mkEvent('paddle', '{}', { 'paddle-signature': 'ts=1;h1=bad' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('inserts a subscription on subscription.activated', async () => {
    const paddleSubId = 'pdl_sub_001'
    mockPaddleVerify.mockResolvedValueOnce(true)

    const rawBody = JSON.stringify({
      event_type: 'subscription.activated',
      data: {
        id: paddleSubId,
        status: 'active',
        customer_id: 'ctm_paddle_001',
        custom_data: { user_id: userId },
        items: [{ price: { id: 'pri_paddle_001' } }],
        current_billing_period: {
          starts_at: '2025-01-01T00:00:00Z',
          ends_at: '2025-02-01T00:00:00Z',
        },
        canceled_at: null,
      },
    })

    const result = await (handler as HandlerFn)(
      mkEvent('paddle', rawBody, { 'paddle-signature': 'ts=1;h1=good' }),
    ) as { received: boolean }
    expect(result.received).toBe(true)

    const db = getCurrentTestDb()
    const sub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.providerSubscriptionId, paddleSubId),
        eq(subscriptions.provider, 'paddle'),
      ),
    })
    expect(sub).toBeDefined()
    expect(sub!.status).toBe('active')
    expect(sub!.providerCustomerId).toBe('ctm_paddle_001')
  })
})
