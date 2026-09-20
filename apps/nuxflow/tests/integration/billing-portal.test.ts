import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedTier, seedSubscription, seedSetting } from '../helpers/seed'
import handler from '../../server/api/v1/memberships/billing-portal.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const STRIPE_PORTAL_URL = 'https://billing.stripe.com/session/test_portal_abc'
const LS_PORTAL_URL = 'https://my-store.lemonsqueezy.com/billing?expires=1234&signature=abc'
const PADDLE_PORTAL_URL = 'https://customer-portal.paddle.com/cpl_test?action=overview&token=abc'

const { mockLsGetSubscription, mockPaddleCreatePortalSession } = vi.hoisted(() => ({
  mockLsGetSubscription: vi.fn(),
  mockPaddleCreatePortalSession: vi.fn(),
}))

vi.mock('../../server/utils/payments/stripe', () => ({
  StripeProvider: vi.fn().mockImplementation(function () {
    return { createBillingPortalSession: vi.fn().mockResolvedValue({ url: STRIPE_PORTAL_URL }) }
  }),
}))

vi.mock('../../server/utils/payments/lemonsqueezy', () => ({
  LemonSqueezyProvider: vi.fn().mockImplementation(function () {
    return { getSubscription: mockLsGetSubscription }
  }),
}))

vi.mock('../../server/utils/payments/paddle', () => ({
  PaddleProvider: vi.fn().mockImplementation(function () {
    return { createPortalSession: mockPaddleCreatePortalSession }
  }),
}))

const SITE = 'site-portal-01'
let userId: string
let portalUserId: string  // separate user whose only subscription has a valid customerId
let tierId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'portal.localhost' })
  userId = await seedUser(db, { email: 'portal-user@portal.test' })
  portalUserId = await seedUser(db, { email: 'portal-user2@portal.test' })
  tierId = await seedTier(db, SITE, { name: 'Pro', price: 999, currency: 'USD', interval: 'month' })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(uid: string | null, body: unknown) {
  return createMockEvent({
    siteId: SITE,
    session: uid ? { user: { id: uid, name: 'Portal User', email: 'portal-user@portal.test' } } : null,
    body,
  }) as unknown as H3Event
}

const VALID_BODY = { returnUrl: 'http://localhost/account' }

describe('POST /api/v1/memberships/billing-portal', () => {
  it('throws 401 when not authenticated', async () => {
    await expect((handler as HandlerFn)(mkEvent(null, VALID_BODY))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 400 when returnUrl is missing', async () => {
    await expect((handler as HandlerFn)(mkEvent(userId, {}))).rejects.toThrow()
  })

  it('throws 400 when returnUrl is not a valid URL', async () => {
    await expect((handler as HandlerFn)(mkEvent(userId, { returnUrl: 'not-a-url' }))).rejects.toThrow()
  })

  it('throws 404 when the user has no subscription at all', async () => {
    // Checking "is there anything to manage" comes before "is the provider configured" —
    // a user with nothing to manage should see "no subscription", not a provider-config
    // error that has nothing to do with their actual situation.
    await expect((handler as HandlerFn)(mkEvent(userId, VALID_BODY))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 when subscription exists but has no customerId', async () => {
    // providerCustomerId is null by default in seedSubscription unless overridden
    await seedSubscription(getCurrentTestDb(), SITE, userId, tierId, {
      providerCustomerId: null as unknown as string,
    })
    await expect((handler as HandlerFn)(mkEvent(userId, VALID_BODY))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 for a free-tier subscription (nothing real to manage)', async () => {
    const freeUserId = await seedUser(getCurrentTestDb(), { email: 'free-portal@portal.test' })
    await seedSubscription(getCurrentTestDb(), SITE, freeUserId, tierId, {
      providerCustomerId: 'cus_irrelevant',
      providerSubscriptionId: `free_${freeUserId.toLowerCase()}`,
      status: 'active',
    })
    await expect((handler as HandlerFn)(mkEvent(freeUserId, VALID_BODY))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 503 when the subscription\'s own provider is not configured', async () => {
    const unconfiguredUserId = await seedUser(getCurrentTestDb(), { email: 'unconfigured-portal@portal.test' })
    await seedSubscription(getCurrentTestDb(), SITE, unconfiguredUserId, tierId, {
      provider: 'stripe',
      providerCustomerId: 'cus_unconfigured',
      status: 'active',
    })
    // No payments.stripe_secret_key seeded for this site yet at this point in the suite.
    await expect((handler as HandlerFn)(mkEvent(unconfiguredUserId, VALID_BODY))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns the billing portal URL when a Stripe subscription with customerId exists', async () => {
    await seedSetting(getCurrentTestDb(), SITE, 'payments.stripe_secret_key', 'sk_test_portal')
    // Use a fresh user whose only subscription has a valid customerId, so
    // findFirst can't accidentally pick a null-customerId row from a prior test.
    await seedSubscription(getCurrentTestDb(), SITE, portalUserId, tierId, {
      provider: 'stripe',
      providerCustomerId: 'cus_portal_test',
      status: 'active',
    })

    const result = await (handler as HandlerFn)(mkEvent(portalUserId, VALID_BODY)) as { url: string }
    expect(result.url).toBe(STRIPE_PORTAL_URL)
  })

  it('returns Lemon Squeezy\'s pre-signed customer_portal URL, re-fetched fresh rather than cached', async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, SITE, 'payments.ls_api_key', 'ls_key_portal')
    await seedSetting(db, SITE, 'payments.ls_store_id', '123')
    const lsUserId = await seedUser(db, { email: 'ls-portal@portal.test' })
    await seedSubscription(db, SITE, lsUserId, tierId, {
      provider: 'lemonsqueezy',
      providerCustomerId: '999',
      providerSubscriptionId: 'ls_sub_portal_001',
      status: 'active',
    })
    mockLsGetSubscription.mockResolvedValueOnce({
      id: 'ls_sub_portal_001',
      attributes: { urls: { customer_portal: LS_PORTAL_URL, update_payment_method: 'https://example.com/update' } },
    })

    const result = await (handler as HandlerFn)(mkEvent(lsUserId, VALID_BODY)) as { url: string }
    expect(result.url).toBe(LS_PORTAL_URL)
    expect(mockLsGetSubscription).toHaveBeenCalledWith('ls_sub_portal_001')
  })

  it('throws 502 when Lemon Squeezy returns no customer_portal URL', async () => {
    const db = getCurrentTestDb()
    const lsUserId = await seedUser(db, { email: 'ls-noportal@portal.test' })
    await seedSubscription(db, SITE, lsUserId, tierId, {
      provider: 'lemonsqueezy',
      providerCustomerId: '998',
      providerSubscriptionId: 'ls_sub_noportal_001',
      status: 'active',
    })
    mockLsGetSubscription.mockResolvedValueOnce({ id: 'ls_sub_noportal_001', attributes: { urls: {} } })

    await expect((handler as HandlerFn)(mkEvent(lsUserId, VALID_BODY))).rejects.toMatchObject({ statusCode: 502 })
  })

  it('returns Paddle\'s general portal overview URL', async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, SITE, 'payments.paddle_api_key', 'pdl_key_portal')
    await seedSetting(db, SITE, 'payments.paddle_vendor_id', '456')
    const paddleUserId = await seedUser(db, { email: 'paddle-portal@portal.test' })
    await seedSubscription(db, SITE, paddleUserId, tierId, {
      provider: 'paddle',
      providerCustomerId: 'ctm_portal_001',
      providerSubscriptionId: 'sub_portal_001',
      status: 'active',
    })
    mockPaddleCreatePortalSession.mockResolvedValueOnce({
      data: { id: 'cpls_test', customer_id: 'ctm_portal_001', urls: { general: { overview: PADDLE_PORTAL_URL } } },
    })

    const result = await (handler as HandlerFn)(mkEvent(paddleUserId, VALID_BODY)) as { url: string }
    expect(result.url).toBe(PADDLE_PORTAL_URL)
    expect(mockPaddleCreatePortalSession).toHaveBeenCalledWith('ctm_portal_001', ['sub_portal_001'])
  })
})
