import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedTier, seedSetting } from '../helpers/seed'
import checkoutHandler from '../../server/api/v1/memberships/checkout.post'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { mockCreateTransaction } = vi.hoisted(() => ({
  mockCreateTransaction: vi.fn(),
}))

vi.mock('../../server/utils/payments/paddle', () => ({
  PaddleProvider: vi.fn().mockImplementation(function () {
    return { createTransaction: mockCreateTransaction }
  }),
}))

const SITE = 'site-checkout-01'
let userId: string
let freeTierId: string
let paidTierId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'checkout.localhost' })
  await seedSetting(db, SITE, 'payments.stripe_secret_key', 'sk_test_123')
  userId = await seedUser(db, { email: 'checkout-user@sub.test' })
  freeTierId = await seedTier(db, SITE, { name: 'Free Plan', price: 0, currency: 'USD', interval: 'month' })
  paidTierId = await seedTier(db, SITE, { name: 'Paid Plan', price: 10, currency: 'USD', interval: 'month' })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(uid: string | null = userId, body: unknown = {}) {
  return createMockEvent({
    siteId: SITE,
    session: uid ? { user: { id: uid, name: 'Checkout User', email: 'checkout-user@sub.test' } } : null,
    body,
  }) as unknown as H3Event
}

describe('POST /api/v1/memberships/checkout', () => {
  it('throws 401 when not authenticated', async () => {
    const event = mkEvent(null, { tierId: freeTierId, returnUrl: 'http://localhost/success' })
    await expect(
      (checkoutHandler as HandlerFn)(event),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('subscribes to a free tier directly and redirects', async () => {
    const event = mkEvent(userId, { tierId: freeTierId, returnUrl: 'http://localhost/success' })
    const result = await (checkoutHandler as HandlerFn)(event) as { url: string }

    expect(result.url).toBe('http://localhost/success')

    // Verify subscription created in DB
    const db = getCurrentTestDb()
    const sub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.siteId, SITE),
        eq(subscriptions.tierId, freeTierId),
      ),
    })

    expect(sub).toBeDefined()
    expect(sub!.status).toBe('active')
    expect(sub!.provider).toBe('stripe')
    expect(sub!.providerSubscriptionId.startsWith('free_')).toBe(true)
  })

  it('throws 409 for unsynced paid tier', async () => {
    const event = mkEvent(userId, { tierId: paidTierId, returnUrl: 'http://localhost/success' })
    await expect(
      (checkoutHandler as HandlerFn)(event),
    ).rejects.toMatchObject({ statusCode: 409, message: 'This tier has not been synced to Stripe' })
  })
})

// ── Paddle checkout ──────────────────────────────────────────────────────────
// Separate site with only Paddle configured (no Stripe/LS secrets), since checkout.post.ts
// tries providers in order and the first configured one wins.

describe('POST /api/v1/memberships/checkout — Paddle', () => {
  const PADDLE_SITE = 'site-checkout-paddle-01'
  let paddleUserId: string
  let paddleTierId: string
  let unsyncedTierId: string

  beforeAll(async () => {
    const db = getCurrentTestDb()
    await seedSite(db, { id: PADDLE_SITE, domain: 'checkout-paddle.localhost' })
    await seedSetting(db, PADDLE_SITE, 'payments.paddle_api_key', 'pdl_key_test')
    await seedSetting(db, PADDLE_SITE, 'payments.paddle_vendor_id', '67890')
    paddleUserId = await seedUser(db, { email: 'paddle-checkout-user@sub.test' })
    paddleTierId = await seedTier(db, PADDLE_SITE, {
      name: 'Paddle Plan', price: 15, currency: 'USD', interval: 'month', paddleProductId: 'pri_test_001',
    })
    unsyncedTierId = await seedTier(db, PADDLE_SITE, { name: 'Unsynced Plan', price: 20, currency: 'USD', interval: 'month' })
  })

  function mkPaddleEvent(tierId: string, returnUrl = 'http://localhost/success') {
    return createMockEvent({
      siteId: PADDLE_SITE,
      session: { user: { id: paddleUserId, name: 'Paddle User', email: 'paddle-checkout-user@sub.test' } },
      body: { tierId, returnUrl },
    }) as unknown as H3Event
  }

  it('throws 409 for a tier not synced to Paddle', async () => {
    await expect(
      (checkoutHandler as HandlerFn)(mkPaddleEvent(unsyncedTierId)),
    ).rejects.toMatchObject({ statusCode: 409, message: 'This tier has not been synced to Paddle' })
  })

  it('creates a Paddle transaction and returns its hosted checkout URL', async () => {
    mockCreateTransaction.mockResolvedValueOnce({
      data: { checkout: { url: 'https://checkout.paddle.com/txn/abc123' } },
    })

    const result = await (checkoutHandler as HandlerFn)(mkPaddleEvent(paddleTierId, 'http://localhost/return')) as { url: string }

    expect(result.url).toBe('https://checkout.paddle.com/txn/abc123')
    expect(mockCreateTransaction).toHaveBeenCalledWith({
      priceId: 'pri_test_001',
      customData: { user_id: paddleUserId, site_id: PADDLE_SITE, tier_id: paddleTierId },
      returnUrl: 'http://localhost/return',
    })
  })
})
