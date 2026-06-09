import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedTier, seedSubscription } from '../helpers/seed'
import handler from '../../server/api/v1/account/subscription.get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-sub-01'
let userId: string
let tierId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'sub.localhost' })
  userId = await seedUser(db, { email: 'subscriber@sub.test' })
  tierId = await seedTier(db, SITE, { name: 'Pro Plan', price: 1999, currency: 'USD', interval: 'month' })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(uid: string | null = userId) {
  return createMockEvent({
    siteId: SITE,
    session: uid ? { user: { id: uid, name: 'Sub User', email: 'subscriber@sub.test' } } : null,
  }) as unknown as H3Event
}

describe('GET /api/v1/account/subscription', () => {
  it('throws 401 when not authenticated', async () => {
    const event = mkEvent(null)
    await expect(
      (handler as HandlerFn)(event),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns null subscription and null tier when no subscription exists', async () => {
    const event = mkEvent()
    const result = await (handler as HandlerFn)(event) as {
      subscription: unknown
      tier: unknown
    }
    expect(result.subscription).toBeNull()
    expect(result.tier).toBeNull()
  })

  it('returns active subscription with tier data', async () => {
    const db = getCurrentTestDb()
    await seedSubscription(db, SITE, userId, tierId, { status: 'active' })

    const event = mkEvent()
    const result = await (handler as HandlerFn)(event) as {
      subscription: { id: string; status: string; provider: string }
      tier: { id: string; name: string; price: number }
    }

    expect(result.subscription).not.toBeNull()
    expect(result.subscription!.status).toBe('active')
    expect(result.subscription!.provider).toBe('stripe')
    expect(result.tier).not.toBeNull()
    expect(result.tier!.name).toBe('Pro Plan')
    expect(result.tier!.price).toBe(1999)
  })

  it('returns subscription status fields correctly', async () => {
    const event = mkEvent()
    const result = await (handler as HandlerFn)(event) as {
      subscription: {
        id: string
        status: string
        provider: string
        currentPeriodEnd: string | null
        cancelledAt: string | null
      }
      tier: unknown
    }

    expect(result.subscription).toMatchObject({
      status: 'active',
      provider: 'stripe',
    })
    expect(result.subscription!.currentPeriodEnd).toBeTruthy()
    expect(result.subscription!.cancelledAt).toBeNull()
  })

  it('returns tier features as an array', async () => {
    const event = mkEvent()
    const result = await (handler as HandlerFn)(event) as {
      subscription: unknown
      tier: { features: unknown }
    }

    expect(Array.isArray(result.tier!.features)).toBe(true)
  })
})
