/**
 * The site directory (utils/site-directory.ts): which member pool serves each address, for
 * the front-door router, rebuilt from what the pools report — with pool bindings faked as
 * plain objects and the router's KV copy as a Map.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { siteDirectory, siteDomains } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { syncSiteDirectory } = await import('../../server/utils/site-directory')
const { syncPoolDirectory } = await import('../../server/scheduled/pool-directory-sync')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { default: directoryPost } = await import('../../server/api/v1/admin/pools/directory.post')
const { default: poolsGet } = await import('../../server/api/v1/admin/pools/index.get')

type Handler = (e: H3Event) => Promise<unknown>
type Config = Record<string, unknown> & { public: Record<string, unknown> }
const g = globalThis as unknown as { useRuntimeConfig: () => Config; __env__?: unknown }
const baseConfig = g.useRuntimeConfig

const PRIMARY = 'site-dir-primary'
let operatorId: string

/** A fake pool binding reporting these sites. */
function pool(poolId: string, sites: { id: string; domain: string; aliases?: string[] }[]) {
  return {
    status: async () => ({ protocol: POOL_PROTOCOL, poolId, commit: null, release: null, siteCount: sites.length, lastMigration: null, settingsReceivedAt: null }),
    listSites: async () => sites.map(s => ({ name: s.domain, status: 'active', createdAt: '', ...s })),
    pushPlatformSettings: async () => ({ stored: 0 }),
  }
}
const down = { status: async () => { throw new Error('pool asleep') }, listSites: async () => [] }

/** The router's KV copy. */
const kv = new Map<string, string>()
const kvBinding = {
  put: async (k: string, v: string) => { kv.set(k, v) },
  delete: async (k: string) => { kv.delete(k) },
  get: async (k: string) => kv.get(k) ?? null,
}

function operatorEvent(pools: Record<string, unknown>, method = 'GET') {
  const event = createMockEvent({
    siteId: PRIMARY,
    method,
    session: { user: { id: operatorId, name: 'Op', email: 'op@dir.test' } },
  }) as unknown as H3Event & { context: Record<string, unknown> }
  event.context.cloudflare = { env: { PLUGIN_KV: kvBinding, ...pools }, context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

async function directoryRows() {
  const rows = await getCurrentTestDb().select().from(siteDirectory)
  return Object.fromEntries(rows.map(r => [r.hostname, `${r.poolId}/${r.poolSiteId}`]))
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'operator.example', isPrimary: true, setupCompleted: true })
  await db.insert(siteDomains).values({ id: 'alias-1', siteId: PRIMARY, hostname: 'old.operator.example', kind: 'platform', status: 'active' })
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  operatorId = await seedUser(db, { email: 'op@dir.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
})
afterAll(teardownTestDb)
afterEach(() => {
  g.useRuntimeConfig = baseConfig
  clearHostingPlatformCache()
})

describe('syncSiteDirectory', () => {
  it('routes every address each pool serves, extra addresses included', async () => {
    const result = await syncSiteDirectory(operatorEvent({
      POOL_A: pool('a', [{ id: 'sa', domain: 'a.example', aliases: ['WWW.a.example'] }]),
      POOL_B: pool('b', [{ id: 'sb', domain: 'b.example' }]),
    }))
    expect(result).toMatchObject({ routed: 3, removed: [], conflicts: [], unreachable: [] })
    expect(await directoryRows()).toEqual({ 'a.example': 'a/sa', 'www.a.example': 'a/sa', 'b.example': 'b/sb' })
    expect(Object.fromEntries(kv)).toEqual({ 'pool-route:a.example': 'a', 'pool-route:www.a.example': 'a', 'pool-route:b.example': 'b' })
  })

  it('never routes an address the control plane\'s own sites use, or one two pools claim', async () => {
    const result = await syncSiteDirectory(operatorEvent({
      POOL_A: pool('a', [{ id: 'sa', domain: 'a.example', aliases: ['operator.example', 'shared.example'] }]),
      POOL_B: pool('b', [{ id: 'sb', domain: 'b.example', aliases: ['old.operator.example', 'shared.example'] }]),
    }))
    expect(result.conflicts.map(c => c.hostname).sort()).toEqual(['old.operator.example', 'operator.example', 'shared.example'])
    expect(result.conflicts.find(c => c.hostname === 'shared.example')!.reason).toMatch(/several pools \(a, b\)/)
    expect(kv.has('pool-route:operator.example')).toBe(false)
    expect(kv.has('pool-route:shared.example')).toBe(false)
    // www.a.example went when pool a stopped reporting it.
    expect(result.removed).toEqual(['www.a.example'])
  })

  it('keeps an unreachable pool\'s addresses, and drops a removed pool\'s', async () => {
    let result = await syncSiteDirectory(operatorEvent({ POOL_A: pool('a', []), POOL_B: down }))
    expect(result.unreachable).toEqual(['POOL_B'])
    expect(await directoryRows()).toEqual({ 'b.example': 'b/sb' })
    expect(kv.get('pool-route:b.example')).toBe('b')

    result = await syncSiteDirectory(operatorEvent({ POOL_A: pool('a', []) }))
    expect(result.removed).toEqual(['b.example'])
    expect(await directoryRows()).toEqual({})
    expect(kv.size).toBe(0)
  })

  it('puts back a router entry that went missing from KV', async () => {
    const pools = { POOL_A: pool('a', [{ id: 's9', domain: 'heal.example' }]) }
    await syncSiteDirectory(operatorEvent(pools))
    kv.delete('pool-route:heal.example')
    const result = await syncSiteDirectory(operatorEvent(pools))
    expect(result.added).toEqual([])
    expect(kv.get('pool-route:heal.example')).toBe('a')
  })

  it('moves an address when its site moves pool', async () => {
    await syncSiteDirectory(operatorEvent({ POOL_A: pool('a', [{ id: 's1', domain: 'moving.example' }]), POOL_B: pool('b', []) }))
    const result = await syncSiteDirectory(operatorEvent({ POOL_A: pool('a', []), POOL_B: pool('b', [{ id: 's1', domain: 'moving.example' }]) }))
    expect(result.added).toEqual(['moving.example'])
    expect(kv.get('pool-route:moving.example')).toBe('b')
  })
})

describe('Super Admin → Pools → Update routing', () => {
  it('syncs and shows how many addresses go to each pool', async () => {
    const pools = { POOL_A: pool('a', [{ id: 's1', domain: 'one.example', aliases: ['two.example'] }]) }
    expect(await (directoryPost as Handler)(operatorEvent(pools, 'POST'))).toMatchObject({ routed: 2 })
    expect(await (poolsGet as Handler)(operatorEvent(pools))).toMatchObject({ routed: { a: 2 } })
  })

  it('is refused on a member pool', async () => {
    g.useRuntimeConfig = () => ({ ...baseConfig(), poolId: 'a', public: { ...baseConfig().public, accountsUrl: 'https://accounts.x.test' } })
    await expect((directoryPost as Handler)(operatorEvent({}, 'POST'))).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('hourly pool-directory-sync', () => {
  it('does nothing on an install without pools', async () => {
    g.__env__ = { PLUGIN_KV: kvBinding }
    expect(await syncPoolDirectory()).toEqual({ skipped: 'no pools' })
  })

  it('syncs when there are pools', async () => {
    g.__env__ = { PLUGIN_KV: kvBinding, POOL_A: pool('a', [{ id: 's1', domain: 'hourly.example' }]) }
    expect(await syncPoolDirectory()).toMatchObject({ routed: 1 })
    expect(kv.get('pool-route:hourly.example')).toBe('a')
  })
})
