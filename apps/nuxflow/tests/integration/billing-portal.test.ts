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

const PORTAL_URL = 'https://billing.stripe.com/session/test_portal_abc'

vi.mock('../../server/utils/payments/stripe', () => ({
  StripeProvider: vi.fn().mockImplementation(function () {
    return { createBillingPortalSession: vi.fn().mockResolvedValue({ url: PORTAL_URL }) }
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

  it('throws 503 when Stripe is not configured', async () => {
    // No stripe key seeded yet for this site
    await expect((handler as HandlerFn)(mkEvent(userId, VALID_BODY))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('throws 404 when user has no Stripe subscription', async () => {
    await seedSetting(getCurrentTestDb(), SITE, 'payments.stripe_secret_key', 'sk_test_portal')
    // User has no subscription at all
    await expect((handler as HandlerFn)(mkEvent(userId, VALID_BODY))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 when subscription exists but has no customerId', async () => {
    // providerCustomerId is null by default in seedSubscription unless overridden
    await seedSubscription(getCurrentTestDb(), SITE, userId, tierId, {
      providerCustomerId: null as unknown as string,
    })
    await expect((handler as HandlerFn)(mkEvent(userId, VALID_BODY))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns the billing portal URL when a Stripe subscription with customerId exists', async () => {
    // Use a fresh user whose only subscription has a valid customerId, so
    // findFirst can't accidentally pick the null-customerId row from the prior test.
    await seedSubscription(getCurrentTestDb(), SITE, portalUserId, tierId, {
      provider: 'stripe',
      providerCustomerId: 'cus_portal_test',
      status: 'active',
    })

    const result = await (handler as HandlerFn)(mkEvent(portalUserId, VALID_BODY)) as { url: string }
    expect(result.url).toBe(PORTAL_URL)
  })
})
