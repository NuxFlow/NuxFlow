import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedTier, seedSetting } from '../helpers/seed'
import createHandler from '../../server/api/v1/memberships/index.post'
import patchHandler from '../../server/api/v1/memberships/[id].patch'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/payments/stripe', () => ({
  StripeProvider: vi.fn().mockImplementation(function () {
    return {
      createProduct: vi.fn().mockResolvedValue({ id: 'prod_mock123' }),
      createPrice: vi.fn().mockResolvedValue({ id: 'price_mock123' }),
      updateProduct: vi.fn().mockResolvedValue({}),
    }
  }),
}))

vi.mock('../../server/utils/payments/lemonsqueezy', () => ({
  LemonSqueezyProvider: vi.fn().mockImplementation(function () {
    return {
      createProduct: vi.fn().mockResolvedValue({ data: { id: 'ls_prod_mock123' } }),
      createVariant: vi.fn().mockResolvedValue({ data: { id: 'ls_var_mock123' } }),
    }
  }),
}))

const SITE = 'site-tiers-01'
let adminId: string
let viewerId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'tiers.localhost' })
  adminId = await seedUser(db, { email: 'admin@tiers.test' })
  viewerId = await seedUser(db, { email: 'viewer@tiers.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, viewerId, SITE, 'viewer')
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(body: unknown, userId = adminId, params: Record<string, string> = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'Admin', email: 'admin@tiers.test' } },
    body,
    params,
  }) as unknown as H3Event
}

// ── POST /api/v1/memberships ──────────────────────────────────────────────────

describe('POST /api/v1/memberships', () => {
  it('throws 401 when not authenticated', async () => {
    const event = createMockEvent({ siteId: SITE, session: null, body: { name: 'T', price: 0 } }) as unknown as H3Event
    await expect((createHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 403 when user is not admin', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: viewerId, name: 'V', email: 'viewer@tiers.test' } },
      body: { name: 'T', price: 0 },
    }) as unknown as H3Event
    await expect((createHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates a free tier with no provider sync', async () => {
    const result = await (createHandler as HandlerFn)(
      mkEvent({ name: 'Free Plan', price: 0, currency: 'USD', interval: 'month' }),
    ) as { name: string; price: number; stripePriceId: string | null; lsVariantId: string | null }

    expect(result.name).toBe('Free Plan')
    expect(result.price).toBe(0)
    expect(result.stripePriceId).toBeNull()
    expect(result.lsVariantId).toBeNull()
  })

  it('creates a paid tier without auto-sync when no provider keys are configured', async () => {
    const result = await (createHandler as HandlerFn)(
      mkEvent({ name: 'Paid No Key', price: 9.99, currency: 'USD', interval: 'month' }),
    ) as { price: number; stripePriceId: string | null; lsVariantId: string | null }

    expect(result.price).toBe(9.99)
    expect(result.stripePriceId).toBeNull()
    expect(result.lsVariantId).toBeNull()
  })

  it('creates a paid tier and auto-syncs to Stripe when Stripe key is configured', async () => {
    await seedSetting(getCurrentTestDb(), SITE, 'payments.stripe_secret_key', 'sk_test_tiers')

    const result = await (createHandler as HandlerFn)(
      mkEvent({ name: 'Pro Plan', price: 19.99, currency: 'USD', interval: 'month' }),
    ) as { stripeProductId: string | null; stripePriceId: string | null }

    expect(result.stripeProductId).toBe('prod_mock123')
    expect(result.stripePriceId).toBe('price_mock123')
  })

  it('creates a paid tier and auto-syncs to Lemon Squeezy when LS keys are configured', async () => {
    await seedSetting(getCurrentTestDb(), SITE, 'payments.ls_api_key', 'ls_key_test')
    await seedSetting(getCurrentTestDb(), SITE, 'payments.ls_store_id', '99')

    const result = await (createHandler as HandlerFn)(
      mkEvent({ name: 'LS Pro Plan', price: 14.99, currency: 'USD', interval: 'month' }),
    ) as { lsVariantId: string | null }

    expect(result.lsVariantId).toBe('ls_var_mock123')
  })

  it('allows explicit provider IDs to bypass auto-sync', async () => {
    const result = await (createHandler as HandlerFn)(
      mkEvent({ name: 'Manual Sync', price: 5, stripeProductId: 'prod_manual', stripePriceId: 'price_manual', lsVariantId: 'ls_var_manual' }),
    ) as { stripeProductId: string | null; stripePriceId: string | null; lsVariantId: string | null }

    expect(result.stripeProductId).toBe('prod_manual')
    expect(result.stripePriceId).toBe('price_manual')
    expect(result.lsVariantId).toBe('ls_var_manual')
  })

  it('rejects a name longer than 100 characters', async () => {
    await expect(
      (createHandler as HandlerFn)(mkEvent({ name: 'x'.repeat(101), price: 0 })),
    ).rejects.toThrow()
  })

  it('rejects a negative price', async () => {
    await expect(
      (createHandler as HandlerFn)(mkEvent({ name: 'Bad Price', price: -1 })),
    ).rejects.toThrow()
  })
})

// ── PATCH /api/v1/memberships/:id ─────────────────────────────────────────────

describe('PATCH /api/v1/memberships/:id', () => {
  let tierId: string

  beforeAll(async () => {
    tierId = await seedTier(getCurrentTestDb(), SITE, {
      name: 'Original Tier',
      price: 5,
      stripeProductId: null,
      stripePriceId: null,
      lsVariantId: null,
    })
  })

  it('throws 401 when not authenticated', async () => {
    const event = createMockEvent({ siteId: SITE, session: null, body: { name: 'X' }, params: { id: tierId } }) as unknown as H3Event
    await expect((patchHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 403 when user is not admin', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: viewerId, name: 'V', email: 'viewer@tiers.test' } },
      body: { name: 'X' },
      params: { id: tierId },
    }) as unknown as H3Event
    await expect((patchHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 404 for an unknown tier id', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkEvent({ name: 'X' }, adminId, { id: 'does-not-exist' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 when tier belongs to a different site', async () => {
    const db = getCurrentTestDb()
    const otherSite = 'site-tiers-other'
    await seedSite(db, { id: otherSite, domain: 'other-tiers.localhost' })
    const otherId = await seedTier(db, otherSite, { name: 'Other', price: 1 })

    await expect(
      (patchHandler as HandlerFn)(mkEvent({ name: 'X' }, adminId, { id: otherId })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('updates the tier name', async () => {
    const result = await (patchHandler as HandlerFn)(
      mkEvent({ name: 'Renamed Tier' }, adminId, { id: tierId }),
    ) as { id: string; name: string }

    expect(result.id).toBe(tierId)
    expect(result.name).toBe('Renamed Tier')
  })

  it('updates isActive flag', async () => {
    const result = await (patchHandler as HandlerFn)(
      mkEvent({ isActive: false }, adminId, { id: tierId }),
    ) as { isActive: boolean }

    expect(result.isActive).toBe(false)
  })

  it('auto-creates Stripe product and price when Stripe is configured and tier has none', async () => {
    // Stripe key is already seeded from the POST tests above
    const result = await (patchHandler as HandlerFn)(
      mkEvent({ name: 'Stripe Synced' }, adminId, { id: tierId }),
    ) as { stripeProductId: string | null; stripePriceId: string | null }

    expect(result.stripeProductId).toBe('prod_mock123')
    expect(result.stripePriceId).toBe('price_mock123')
  })

  it('auto-creates LS product and variant when LS is configured and tier has no variant', async () => {
    // LS keys already seeded from the POST tests above
    const result = await (patchHandler as HandlerFn)(
      mkEvent({ name: 'LS Synced' }, adminId, { id: tierId }),
    ) as { lsVariantId: string | null }

    expect(result.lsVariantId).toBe('ls_var_mock123')
  })

  it('creates a new LS variant when price changes', async () => {
    // Seed a tier that already has an lsVariantId so we can test the price-change branch
    const db = getCurrentTestDb()
    const lsTierId = await seedTier(db, SITE, {
      name: 'LS Price Change',
      price: 10,
      lsVariantId: 'ls_var_existing',
    })

    const result = await (patchHandler as HandlerFn)(
      mkEvent({ price: 20 }, adminId, { id: lsTierId }),
    ) as { lsVariantId: string | null }

    // Price changed => new variant created
    expect(result.lsVariantId).toBe('ls_var_mock123')
  })
})
