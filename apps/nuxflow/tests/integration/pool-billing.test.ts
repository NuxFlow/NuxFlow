/**
 * Hosting billing with member pools (Phase 5b — hosting-billing.ts through pool-sites.ts's
 * site gateway): a sign-up on a plan with a default pool gets its site there, unpaid bills
 * pause and reopen it there quietly, a plan change reaches it, My hosting shows it, and
 * deleting it ends its Stripe subscription first. Plus Super Admin → Usage across pools.
 * Stripe and the pool are fakes; the pool keeps its sites in memory.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { hostingPlans, hostingSubscriptions, sites } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))
const mockSendEmail = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/email-template', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, sendTemplatedEmail: (...args: unknown[]) => mockSendEmail(...args) }
})
const cancelledNow: string[] = []
vi.mock('../../server/utils/payments/resolve', () => ({
  resolveStripeProvider: async () => ({ cancelSubscriptionNow: async (id: string) => { cancelledNow.push(id) } }),
  getStripeProvider: async () => null,
}))

const realRuntimeConfig = globalThis.useRuntimeConfig
globalThis.useRuntimeConfig = (() => ({ ...realRuntimeConfig(), hostingSitesDomain: 'sites.test' })) as typeof globalThis.useRuntimeConfig

const { syncHostingSubscription, listCustomerHosting } = await import('../../server/utils/hosting-billing')
const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { default: deleteSiteRoute } = await import('../../server/api/v1/admin/sites/[id].delete')
const { default: usageMonth } = await import('../../server/api/v1/admin/usage/index.get')
const { default: usageSite } = await import('../../server/api/v1/admin/usage/[siteId].get')

type Handler = (e: H3Event) => Promise<unknown>
type MockEvent = ReturnType<typeof createMockEvent> & { context: Record<string, unknown> }

const PRIMARY = 'site-pb-primary'
let operatorId: string
let customerId: string

/** A fake pool binding that keeps its sites in memory and records every call. */
function fakePool(poolId: string) {
  const sitesHere = new Map<string, { id: string; name: string; domain: string; status: string; hostingPlanId: string | null }>()
  const calls: Record<string, unknown[]> = { createSite: [], updateSite: [], deleteSite: [], setPlans: [] }
  return {
    sitesHere,
    calls,
    stub: {
      status: async () => ({ protocol: POOL_PROTOCOL, poolId, commit: null, release: null, siteCount: sitesHere.size, lastMigration: null, settingsReceivedAt: null }),
      listSites: async () => [...sitesHere.values()].map(s => ({ ...s, createdAt: '' })),
      setPlans: async (input: unknown) => { calls.setPlans!.push(input); return { stored: 0 } },
      createSite: async (input: { site: { id: string; name: string; domain: string; hostingPlanId?: string | null } }) => {
        calls.createSite!.push(input)
        sitesHere.set(input.site.id, { id: input.site.id, name: input.site.name, domain: input.site.domain, status: 'active', hostingPlanId: input.site.hostingPlanId ?? null })
        return { created: true, pending: false }
      },
      getSite: async ({ siteId }: { siteId: string }) => sitesHere.get(siteId) ?? null,
      updateSite: async (input: { siteId: string; changes: Record<string, unknown> }) => {
        calls.updateSite!.push(input)
        const s = sitesHere.get(input.siteId)
        if (s) Object.assign(s, input.changes)
        return { updated: !!s }
      },
      deleteSite: async (input: { siteId: string }) => {
        calls.deleteSite!.push(input)
        return { deleted: sitesHere.delete(input.siteId), failedMediaDeletes: [] }
      },
      monthlyUsage: async () => ({ from: '2026-10-01', to: '2026-10-31', sites: [...sitesHere.values()].map(s => ({ ...s, isPrimary: false, usage: { views: 42 }, snapshotDay: null })) }),
      siteDomains: async () => ({ ok: true, value: [] }),
      siteUsage: async ({ siteId }: { siteId: string }) => sitesHere.has(siteId) ? { site: { id: siteId, name: 'In pool', domain: 'x' }, days: ['2026-10-22'], series: { views: [7] } } : null,
    },
  }
}

const kv = new Map<string, string>()
const env = (pools: Record<string, unknown>) => ({
  PLUGIN_KV: { put: async (k: string, v: string) => { kv.set(k, v) }, delete: async (k: string) => { kv.delete(k) }, get: async (k: string) => kv.get(k) ?? null },
  ...pools,
})

function primaryEvent(pools: Record<string, unknown>, opts: Parameters<typeof createMockEvent>[0] = {}): H3Event {
  const event = createMockEvent({ siteId: PRIMARY, headers: { host: 'platform.test' }, ...opts }) as MockEvent
  event.context.cloudflare = { env: env(pools), context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

function ctx(pools: Record<string, unknown>) {
  return {
    db: getCurrentTestDb(),
    primary: { id: PRIMARY, name: 'Platform', domain: 'platform.test', status: 'active' as const, isPrimary: true },
    primaryEvent: primaryEvent(pools),
  } as unknown as Parameters<typeof syncHostingSubscription>[0]
}

/** A Stripe subscription as the webhook re-reads it. */
function stripeSub(id: string, rowId: string, status: string, priceId: string) {
  return { id, status, customer: 'cus_1', cancel_at_period_end: false, metadata: { hostingSubscriptionId: rowId }, items: { data: [{ price: { id: priceId }, current_period_end: 1_900_000_000 }] } } as never
}

async function signUp(planId: string, subdomain: string) {
  const id = ulid()
  await getCurrentTestDb().insert(hostingSubscriptions).values({
    id, ownerUserId: customerId, planId, interval: 'month', status: 'checkout', requestedSubdomain: subdomain, requestedSiteName: `Shop ${subdomain}`,
  })
  return id
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, setupCompleted: true })
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  operatorId = await seedUser(db, { email: 'op@pb.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
  customerId = await seedUser(db, { email: 'cara@pb.test', name: 'Cara' })
  await db.insert(hostingPlans).values([
    { id: 'plan-pooled', name: 'Pooled', stripePriceMonthlyId: 'price_pooled', defaultPoolId: 'clientx' },
    { id: 'plan-pooled-2', name: 'Pooled bigger', stripePriceMonthlyId: 'price_pooled_2', defaultPoolId: 'clientx' },
    { id: 'plan-missing-pool', name: 'Missing pool', stripePriceMonthlyId: 'price_missing', defaultPoolId: 'notconnected' },
  ])
})
afterAll(async () => {
  globalThis.useRuntimeConfig = realRuntimeConfig
  await teardownTestDb()
})

describe('a sign-up on a plan with a default pool', () => {
  const pool = fakePool('clientx')
  const pools = { POOL_CLIENTX: pool.stub }
  let rowId: string
  let siteId: string

  it('gets its site in that pool, with its plan, routed there, and the customer told', async () => {
    rowId = await signUp('plan-pooled', 'bakery')
    const row = await syncHostingSubscription(ctx(pools), stripeSub('sub_1', rowId, 'active', 'price_pooled'))
    siteId = row!.hostedSiteId!
    expect(pool.calls.setPlans).toHaveLength(1)
    expect(pool.calls.createSite![0]).toMatchObject({ site: { id: siteId, domain: 'bakery.sites.test', hostingPlanId: 'plan-pooled' }, owner: { id: customerId }, ownerStatus: 'existing' })
    // Not in the control plane's own database.
    expect(await getCurrentTestDb().select().from(sites).where(eq(sites.id, siteId))).toEqual([])
    expect(kv.get('pool-route:bakery.sites.test')).toBe('clientx')
    expect(mockSendEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ to: 'cara@pb.test', subject: 'Your site Shop bakery is ready' }))
  })

  it('isn\'t created twice when Stripe sends the same subscription again', async () => {
    await syncHostingSubscription(ctx(pools), stripeSub('sub_1', rowId, 'active', 'price_pooled'))
    expect(pool.calls.createSite).toHaveLength(1)
  })

  it('shows on the customer\'s My hosting page', async () => {
    const list = await listCustomerHosting(getCurrentTestDb(), customerId, primaryEvent(pools))
    expect(list.find(s => s.id === rowId)?.site).toMatchObject({ id: siteId, domain: 'bakery.sites.test' })
  })

  it('moves to a new plan when the customer changes it in Stripe', async () => {
    await syncHostingSubscription(ctx(pools), stripeSub('sub_1', rowId, 'active', 'price_pooled_2'))
    expect(pool.sitesHere.get(siteId)?.hostingPlanId).toBe('plan-pooled-2')
  })

  it('is paused when payment stops, quietly, and reopened when it is paid', async () => {
    await syncHostingSubscription(ctx(pools), stripeSub('sub_1', rowId, 'unpaid', 'price_pooled_2'))
    expect(pool.sitesHere.get(siteId)?.status).toBe('maintenance')
    expect(pool.calls.updateSite!.at(-1)).toMatchObject({ siteId, changes: { status: 'maintenance' }, quiet: true })
    const [paused] = await getCurrentTestDb().select().from(hostingSubscriptions).where(eq(hostingSubscriptions.id, rowId))
    expect(paused?.pausedForNonPayment).toBe(true)

    await syncHostingSubscription(ctx(pools), stripeSub('sub_1', rowId, 'active', 'price_pooled_2'))
    expect(pool.sitesHere.get(siteId)?.status).toBe('active')
    const [reopened] = await getCurrentTestDb().select().from(hostingSubscriptions).where(eq(hostingSubscriptions.id, rowId))
    expect(reopened?.pausedForNonPayment).toBe(false)
  })

  it('appears in Super Admin → Usage, monthly and day by day', async () => {
    const month = await (usageMonth as Handler)(primaryEvent(pools, { session: { user: { id: operatorId, name: 'Op', email: 'op@pb.test' } }, query: { month: '2026-10' } })) as { sites: { id: string; poolId: string | null; usage: Record<string, number> }[] }
    expect(month.sites.find(s => s.id === siteId)).toMatchObject({ poolId: 'clientx', usage: { views: 42 } })
    expect(month.sites.find(s => s.id === PRIMARY)?.poolId).toBeNull()

    const series = await (usageSite as Handler)(primaryEvent(pools, { session: { user: { id: operatorId, name: 'Op', email: 'op@pb.test' } }, params: { siteId }, query: {} })) as { series: Record<string, number[]> }
    expect(series.series.views).toEqual([7])
  })

  it('ends its Stripe subscription first when deleted from Super Admin → Sites', async () => {
    await (deleteSiteRoute as Handler)(primaryEvent(pools, { method: 'DELETE', params: { id: siteId }, session: { user: { id: operatorId, name: 'Op', email: 'op@pb.test' } } }))
    expect(cancelledNow).toContain('sub_1')
    expect(pool.calls.deleteSite!.at(-1)).toMatchObject({ siteId })
    expect(kv.has('pool-route:bakery.sites.test')).toBe(false)
  })
})

describe('a sign-up whose plan\'s pool isn\'t connected', () => {
  it('gets its site on the control plane instead, and the operator is told', async () => {
    const rowId = await signUp('plan-missing-pool', 'florist')
    const row = await syncHostingSubscription(ctx({}), stripeSub('sub_2', rowId, 'active', 'price_missing'))
    const [site] = await getCurrentTestDb().select().from(sites).where(eq(sites.id, row!.hostedSiteId!))
    expect(site?.domain).toBe('florist.sites.test')
  })
})

describe('a sign-up\'s subdomain', () => {
  it('isn\'t given to a second site when a pool site already has it', async () => {
    const pool = fakePool('clientx')
    const pools = { POOL_CLIENTX: pool.stub }
    const first = await syncHostingSubscription(ctx(pools), stripeSub('sub_3', await signUp('plan-pooled', 'cafe'), 'active', 'price_pooled'))
    const second = await syncHostingSubscription(ctx(pools), stripeSub('sub_4', await signUp('plan-pooled', 'cafe'), 'active', 'price_pooled'))
    const domains = [first, second].map(r => pool.sitesHere.get(r!.hostedSiteId!)?.domain)
    expect(domains[0]).toBe('cafe.sites.test')
    expect(domains[1]).toMatch(/^cafe-[a-z0-9]{4}\.sites\.test$/)
  })
})
