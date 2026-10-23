/**
 * Pools, both ends of the private RPC: what a member pool answers (utils/pool-admin.ts —
 * the logic behind its NuxflowPoolAdmin entrypoint), and the control plane's Pools page
 * and settings push (utils/pools.ts, /api/v1/admin/pools), with pool bindings faked as
 * plain objects in the Cloudflare env.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { POOL_PROTOCOL, poolSites, poolStatus, receivePlatformSettings } = await import('../../server/utils/pool-admin')
const { getPlatformSetting } = await import('../../server/utils/control-plane')
const { releaseSortKey, POOL_BINDING_RE } = await import('../../server/utils/pools')
const { poolBindingName } = await import('../../shared/lib/pool-id')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { default: poolsGet } = await import('../../server/api/v1/admin/pools/index.get')
const { default: poolsSettingsPost } = await import('../../server/api/v1/admin/pools/settings.post')
const { default: platformPut } = await import('../../server/api/v1/admin/platform/index.put')

type Handler = (e: H3Event) => Promise<unknown>
type Config = Record<string, unknown> & { public: Record<string, unknown> }
const g = globalThis as unknown as { useRuntimeConfig: () => Config }
const baseConfig = g.useRuntimeConfig

function setConfig(extra: Record<string, unknown>, accountsUrl = '') {
  g.useRuntimeConfig = () => {
    const base = baseConfig()
    return { ...base, ...extra, public: { ...base.public, accountsUrl } }
  }
  clearHostingPlatformCache()
}
const asPool = (poolId = 'clientx') => setConfig({ poolId }, 'https://accounts.platform.test')

const PRIMARY = 'site-pools-primary'
let operatorId: string

/** A super admin's request on the control plane, with these pool bindings in the env. */
function operatorEvent(env: Record<string, unknown>, opts: { body?: unknown; method?: string } = {}) {
  const waits: Promise<unknown>[] = []
  const event = createMockEvent({
    siteId: PRIMARY,
    method: opts.method ?? 'GET',
    body: opts.body,
    session: { user: { id: operatorId, name: 'Op', email: 'op@pools.test' } },
  }) as unknown as H3Event & { context: Record<string, unknown> }
  event.context.cloudflare = { env, context: { waitUntil: (p: Promise<unknown>) => { waits.push(p) } } }
  return { event: event as unknown as H3Event, waits }
}

/** A fake pool binding: answers like a pool and records what it was sent. */
function fakePool(status: Record<string, unknown>, sites: unknown[] = []) {
  const received: unknown[] = []
  const plans: unknown[] = []
  return {
    received,
    plans,
    stub: {
      status: async () => ({ protocol: POOL_PROTOCOL, commit: null, release: null, siteCount: sites.length, lastMigration: null, settingsReceivedAt: null, ...status }),
      listSites: async () => sites,
      pushPlatformSettings: async (payload: unknown) => { received.push(payload); return { stored: 1 } },
      setPlans: async (payload: unknown) => { plans.push(payload); return { stored: 0 } },
    },
  }
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, name: 'Operator', domain: 'operator.example', isPrimary: true, setupCompleted: true })
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  await seedSetting(db, PRIMARY, 'platform.ai_daily_credit_cap', '250')
  operatorId = await seedUser(db, { email: 'op@pools.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
})
afterAll(teardownTestDb)
afterEach(() => setConfig({}))

describe('a member pool answering its control plane', () => {
  it('reports its status and sites', async () => {
    asPool()
    setConfig({ poolId: 'clientx', buildCommit: 'abc1234def', buildRelease: 'ring2-2026-10-24' }, 'https://accounts.platform.test')
    const status = await poolStatus(getCurrentTestDb())
    expect(status).toMatchObject({ protocol: POOL_PROTOCOL, poolId: 'clientx', commit: 'abc1234def', release: 'ring2-2026-10-24', siteCount: 1, settingsReceivedAt: null })
    expect((await poolSites(getCurrentTestDb())).map(s => s.domain)).toEqual(['operator.example'])
  })

  it('stores pushed settings, skips keys it doesn\'t know, and records when they came', async () => {
    asPool()
    const db = getCurrentTestDb()
    const res = await receivePlatformSettings(db, {
      protocol: POOL_PROTOCOL,
      settings: { 'platform.ai_daily_credit_cap': '40', 'analytics.cf_api_token': null, 'cloudflare.account_id': null, 'some.future_setting': 'x' },
    })
    expect(res).toEqual({ stored: 1 })
    expect(await getPlatformSetting(db, 'platform.ai_daily_credit_cap')).toBe('40')
    expect((await poolStatus(db)).settingsReceivedAt).not.toBeNull()
  })

  it('records the arrival even when every setting is empty', async () => {
    asPool()
    const db = getCurrentTestDb()
    await receivePlatformSettings(db, { protocol: POOL_PROTOCOL, settings: { 'platform.ai_daily_credit_cap': null } })
    expect(await getPlatformSetting(db, 'platform.ai_daily_credit_cap')).toBeNull()
    expect((await poolStatus(db)).settingsReceivedAt).not.toBeNull()
  })

  it('accepts a control plane one protocol version apart, but not two', async () => {
    asPool()
    const db = getCurrentTestDb()
    await expect(receivePlatformSettings(db, { protocol: POOL_PROTOCOL + 1, settings: {} })).resolves.toBeTruthy()
    await expect(receivePlatformSettings(db, { protocol: POOL_PROTOCOL + 2, settings: {} })).rejects.toThrow(/Incompatible pool protocol/)
    await expect(receivePlatformSettings(db, { settings: {} } as never)).rejects.toThrow(/Incompatible pool protocol/)
  })

  it('refuses pushed settings unless it is a member pool', async () => {
    await expect(receivePlatformSettings(getCurrentTestDb(), { protocol: POOL_PROTOCOL, settings: {} })).rejects.toThrow(/Only a member pool/)
  })
})

describe('Super Admin → Pools', () => {
  it('lists every pool binding (and nothing else), each pool\'s sites, and flags trouble', async () => {
    const good = fakePool({ poolId: 'clientx', commit: 'c1', release: 'ring1-2026-10-25' }, [{ id: 's1', name: 'Client', domain: 'client.example', status: 'active', createdAt: '' }])
    const older = fakePool({ poolId: 'main2', commit: 'c0', release: 'ring2-2026-10-20-2' })
    const notAPool = fakePool({ poolId: null })
    const tooNew = fakePool({ poolId: 'future', protocol: POOL_PROTOCOL + 5 })
    const down = { status: async () => { throw new Error('connection refused') }, listSites: async () => [] }
    const { event } = operatorEvent({
      POOL_CLIENTX: good.stub, POOL_MAIN2: older.stub, POOL_PLAIN: notAPool.stub, POOL_FUTURE: tooNew.stub, POOL_DOWN: down,
      DB: {}, POOL_lowercase: good.stub, POOLX: good.stub, POOL_NULL: null,
    })
    const res = await (poolsGet as Handler)(event) as { pools: { binding: string; error: string | null; sites: unknown[] }[]; newestRelease: string | null; controlPlane: { siteCount: number } }

    expect(res.pools.map(p => p.binding)).toEqual(['POOL_CLIENTX', 'POOL_DOWN', 'POOL_FUTURE', 'POOL_MAIN2', 'POOL_PLAIN'])
    const by = Object.fromEntries(res.pools.map(p => [p.binding, p]))
    expect(by.POOL_CLIENTX).toMatchObject({ error: null, sites: [{ domain: 'client.example' }] })
    expect(by.POOL_MAIN2!.error).toBeNull()
    expect(by.POOL_DOWN!.error).toMatch(/connection refused/)
    expect(by.POOL_FUTURE!.error).toMatch(/Incompatible pool protocol/)
    expect(by.POOL_PLAIN!.error).toMatch(/isn't a member pool/)
    expect(res.newestRelease).toBe('ring1-2026-10-25')
    expect(res.controlPlane.siteCount).toBe(1)
  })

  it('sends the control plane\'s platform settings to every pool, carrying on past one that fails', async () => {
    setConfig({ cloudflareAccountId: 'a'.repeat(32) })
    const a = fakePool({ poolId: 'a' })
    const b = fakePool({ poolId: 'b' })
    const broken = { ...fakePool({ poolId: 'c' }).stub, pushPlatformSettings: async () => { throw new Error('pool asleep') } }
    const { event } = operatorEvent({ POOL_A: a.stub, POOL_BROKEN: broken, POOL_B: b.stub }, { method: 'POST' })
    const res = await (poolsSettingsPost as Handler)(event) as { results: { binding: string; ok: boolean; error: string | null }[] }

    expect(res.results).toEqual([
      { binding: 'POOL_A', ok: true, error: null },
      { binding: 'POOL_B', ok: true, error: null },
      { binding: 'POOL_BROKEN', ok: false, error: 'pool asleep' },
    ])
    expect(a.received).toEqual([{
      protocol: POOL_PROTOCOL,
      // The cap from the primary site; the account id from the deployment's variable.
      settings: { 'platform.ai_daily_credit_cap': '250', 'analytics.cf_api_token': null, 'cloudflare.account_id': 'a'.repeat(32) },
    }])
    expect(b.received).toHaveLength(1)
    // The hosting plans go with them, so a newly connected pool has everything (pool-sites.ts).
    expect(a.plans).toEqual([{ protocol: POOL_PROTOCOL, plans: [] }])
  })

  it('sends them on automatically when Super Admin → Platform saves one', async () => {
    const pool = fakePool({ poolId: 'a' })
    const { event, waits } = operatorEvent({ POOL_A: pool.stub }, { method: 'PUT', body: { aiDailyCreditCap: 300 } })
    await (platformPut as Handler)(event)
    await Promise.all(waits)
    expect(pool.received).toEqual([expect.objectContaining({ settings: expect.objectContaining({ 'platform.ai_daily_credit_cap': '300' }) })])
  })

  it('is only for a super admin', async () => {
    const event = createMockEvent({ siteId: PRIMARY, session: { user: { id: 'nobody', name: 'N', email: 'n@x.test' } } }) as unknown as H3Event
    await expect((poolsGet as Handler)(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('doesn\'t exist on a member pool', async () => {
    asPool()
    const { event } = operatorEvent({})
    await expect((poolsGet as Handler)(event)).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/control panel/) })
    await expect((poolsSettingsPost as Handler)(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('names and releases', () => {
  it('a pool\'s binding name is what the Pools page looks for', () => {
    for (const id of ['clientx', 'eu-1', 'canary']) expect(POOL_BINDING_RE.test(poolBindingName(id))).toBe(true)
    expect(poolBindingName('eu-1')).toBe('POOL_EU_1')
  })

  it('orders releases by date and same-day number, whatever the ring', () => {
    const sorted = ['ring2-2026-10-24', 'ring1-2026-10-25', 'ring1-2026-10-24-2', 'new-pool-x', 'ring1-2026-10-24']
      .sort((a, b) => releaseSortKey(a).localeCompare(releaseSortKey(b)))
    expect(sorted).toEqual(['new-pool-x', 'ring2-2026-10-24', 'ring1-2026-10-24', 'ring1-2026-10-24-2', 'ring1-2026-10-25'])
  })
})

describe('Super Admin → Pools: keeping customer sites off the control panel', () => {
  it('counts customer sites still here and plans whose sign-ups land here, not the operator\'s own or a copy mid-move', async () => {
    const db = getCurrentTestDb()
    const { controlPlaneSummary } = await import('../../server/utils/pools')
    const { hostingPlans, sites } = await import('@nuxflow/db/schema')
    const { eq } = await import('drizzle-orm')
    const before = await controlPlaneSummary(db)
    await seedSite(db, { id: 'site-pools-cafe', domain: 'cafe.example' })
    await seedSite(db, { id: 'site-pools-moving-in', domain: 'incoming.example', moveState: 'incoming' })
    await db.insert(hostingPlans).values([{ id: 'plan-here', name: 'Here' }, { id: 'plan-pooled', name: 'Pooled', defaultPoolId: 'main' }])

    const after = await controlPlaneSummary(db)
    expect(after.customerSites).toBe(before.customerSites + 1)
    expect(after.plansWithoutPool).toBe(before.plansWithoutPool + 1)

    await db.delete(sites).where(eq(sites.id, 'site-pools-cafe'))
    await db.delete(sites).where(eq(sites.id, 'site-pools-moving-in'))
    await db.delete(hostingPlans)
  })
})
