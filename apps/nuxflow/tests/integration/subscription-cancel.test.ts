import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedTier, seedSubscription, seedSetting } from '../helpers/seed'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import handler from '../../server/api/v1/account/subscription.delete'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { mockStripeCancel, mockLsCancel, mockPaddleCancel } = vi.hoisted(() => ({
  mockStripeCancel: vi.fn().mockResolvedValue({}),
  mockLsCancel: vi.fn().mockResolvedValue({ data: { id: 'ls_sub_001', attributes: { status: 'cancelled' } } }),
  mockPaddleCancel: vi.fn().mockResolvedValue({ id: 'pdl_sub_001', status: 'canceled' }),
}))

vi.mock('../../server/utils/payments/stripe', () => ({
  StripeProvider: vi.fn().mockImplementation(() => ({
    cancelSubscription: mockStripeCancel,
  })),
}))

vi.mock('../../server/utils/payments/lemonsqueezy', () => ({
  LemonSqueezyProvider: vi.fn().mockImplementation(() => ({
    cancelSubscription: mockLsCancel,
  })),
}))

vi.mock('../../server/utils/payments/paddle', () => ({
  PaddleProvider: vi.fn().mockImplementation(() => ({
    cancelSubscription: mockPaddleCancel,
  })),
}))

const SITE = 'site-cancel-01'
let userId: string
let userId2: string
let userId3: string
let userId4: string
let tierId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'cancel.localhost' })
  userId = await seedUser(db, { email: 'cancel-stripe@cancel.test' })
  userId2 = await seedUser(db, { email: 'cancel-ls@cancel.test' })
  userId3 = await seedUser(db, { email: 'cancel-paddle@cancel.test' })
  userId4 = await seedUser(db, { email: 'cancel-free@cancel.test' })
  tierId = await seedTier(db, SITE, { name: 'Pro', price: 999, currency: 'USD', interval: 'month' })

  // Seed provider settings
  await seedSetting(db, SITE, 'payments.stripe_secret_key', 'sk_test_cancel')
  await seedSetting(db, SITE, 'payments.ls_api_key', 'ls_key_cancel')
  await seedSetting(db, SITE, 'payments.ls_store_id', '999')
  await seedSetting(db, SITE, 'payments.paddle_api_key', 'pdl_key_cancel')
  await seedSetting(db, SITE, 'payments.paddle_vendor_id', '888')
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(uid: string | null = userId) {
  return createMockEvent({
    siteId: SITE,
    session: uid ? { user: { id: uid, name: 'User', email: `${uid}@cancel.test` } } : null,
  }) as unknown as H3Event
}

describe('DELETE /api/v1/account/subscription', () => {
  it('throws 401 when not authenticated', async () => {
    await expect((handler as HandlerFn)(mkEvent(null))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 404 when no active subscription exists', async () => {
    const noSubUserId = await seedUser(getCurrentTestDb(), { email: 'no-sub@cancel.test' })
    await expect((handler as HandlerFn)(mkEvent(noSubUserId))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('cancels a Stripe subscription via provider and marks it cancelled in the DB', async () => {
    const db = getCurrentTestDb()
    await seedSubscription(db, SITE, userId, tierId, {
      provider: 'stripe',
      providerSubscriptionId: 'sub_stripe_cancel_001',
      status: 'active',
    })

    const result = await (handler as HandlerFn)(mkEvent(userId)) as { cancelled: boolean }
    expect(result.cancelled).toBe(true)
    expect(mockStripeCancel).toHaveBeenCalledWith('sub_stripe_cancel_001')

    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.userId, userId), eq(subscriptions.siteId, SITE)),
    })
    expect(sub!.status).toBe('cancelled')
    expect(sub!.cancelledAt).toBeTruthy()
  })

  it('cancels a Lemon Squeezy subscription via provider', async () => {
    const db = getCurrentTestDb()
    await seedSubscription(db, SITE, userId2, tierId, {
      provider: 'lemonsqueezy',
      providerSubscriptionId: 'ls_sub_cancel_001',
      status: 'active',
    })

    const result = await (handler as HandlerFn)(mkEvent(userId2)) as { cancelled: boolean }
    expect(result.cancelled).toBe(true)
    expect(mockLsCancel).toHaveBeenCalledWith('ls_sub_cancel_001')

    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.userId, userId2), eq(subscriptions.siteId, SITE)),
    })
    expect(sub!.status).toBe('cancelled')
  })

  it('cancels a Paddle subscription via provider', async () => {
    const db = getCurrentTestDb()
    await seedSubscription(db, SITE, userId3, tierId, {
      provider: 'paddle',
      providerSubscriptionId: 'pdl_sub_cancel_001',
      status: 'active',
    })

    const result = await (handler as HandlerFn)(mkEvent(userId3)) as { cancelled: boolean }
    expect(result.cancelled).toBe(true)
    expect(mockPaddleCancel).toHaveBeenCalledWith('pdl_sub_cancel_001')

    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.userId, userId3), eq(subscriptions.siteId, SITE)),
    })
    expect(sub!.status).toBe('cancelled')
  })

  it('cancels a free subscription locally without calling any provider', async () => {
    const db = getCurrentTestDb()
    await seedSubscription(db, SITE, userId4, tierId, {
      provider: 'stripe',
      providerSubscriptionId: 'free_abc123',
      status: 'active',
    })

    mockStripeCancel.mockClear()
    const result = await (handler as HandlerFn)(mkEvent(userId4)) as { cancelled: boolean }
    expect(result.cancelled).toBe(true)
    expect(mockStripeCancel).not.toHaveBeenCalled()

    const sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.userId, userId4), eq(subscriptions.siteId, SITE)),
    })
    expect(sub!.status).toBe('cancelled')
  })
})
