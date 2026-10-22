/**
 * Member pools (server/utils/control-plane.ts): a Worker started with NUXT_POOL_ID holds
 * some of a hosting platform's sites, and must never act like a fresh install or a
 * control plane. Each test switches pool mode on or off through runtime config; with it
 * off, the same database behaves exactly like an ordinary install.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { platformSettings } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const {
  POOL_PLATFORM_SETTINGS, getPlatformSetting, isMemberPool, storePlatformSettings,
} = await import('../../server/utils/control-plane')
const { default: poolConfigMiddleware, poolConfigProblem } = await import('../../server/middleware/00.pool-config')
const { default: multiSiteMiddleware, clearSiteCache } = await import('../../server/middleware/02.multi-site')
const { default: setupStatus, clearSetupStatusCache } = await import('../../server/api/v1/setup/status.get')
const { default: setupComplete } = await import('../../server/api/v1/setup/complete.post')
const { isHostingPlatform, clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { isAccountsHost } = await import('../../server/utils/accounts-origin')
const { AI_DAILY_CAP_SETTING_KEY, clearAiDailyCapCache, getAiDailyCap } = await import('../../server/utils/ai-allowance')
const { ANALYTICS_TOKEN_KEY } = await import('../../server/utils/analytics')

type Handler = (e: H3Event) => Promise<unknown>
type Config = Record<string, unknown> & { public: Record<string, unknown> }
const g = globalThis as unknown as { useRuntimeConfig: () => Config }
const baseConfig = g.useRuntimeConfig

/** Pool mode on (with the control plane's sign-in domain, as a real pool has) or off. */
function setPool(poolId: string | null, accountsUrl = 'https://accounts.platform.test') {
  g.useRuntimeConfig = () => {
    const base = baseConfig()
    return { ...base, poolId: poolId ?? '', public: { ...base.public, accountsUrl: poolId ? accountsUrl : '' } }
  }
  clearSiteCache()
  clearSetupStatusCache()
  clearHostingPlatformCache()
  clearAiDailyCapCache()
}

function hostEvent(host: string, path = '/') {
  const event = createMockEvent({ headers: { host }, path }) as unknown as Record<string, unknown>
  event.path = path
  return event as unknown as H3Event
}

const ctx = (e: H3Event) => (e as unknown as { context: Record<string, unknown> }).context
const status = (e: H3Event) => (e as unknown as { _status?: number })._status

beforeAll(initTestDb)
afterAll(teardownTestDb)
afterEach(() => setPool(null))

describe('pool configuration', () => {
  it('is off on an ordinary install', () => {
    expect(isMemberPool()).toBe(false)
    expect(poolConfigProblem()).toBeNull()
  })

  it('accepts a well-formed pool with the control plane\'s sign-in domain', () => {
    setPool('clientx')
    expect(isMemberPool()).toBe(true)
    expect(poolConfigProblem()).toBeNull()
  })

  it('refuses every request when the pool is set up wrong', async () => {
    setPool('Client X')
    expect(poolConfigProblem()).toMatch(/lower-case/)
    setPool('clientx', '')
    expect(poolConfigProblem()).toMatch(/NUXT_PUBLIC_ACCOUNTS_URL/)
    const event = hostEvent('anything.test')
    const res = await (poolConfigMiddleware as unknown as Handler)(event)
    expect(status(event)).toBe(503)
    expect(res).toMatchObject({ statusCode: 503 })
  })
})

describe('an empty pool is not a fresh install', () => {
  it('reports nothing to set up', async () => {
    setPool('clientx')
    const res = await (setupStatus as Handler)(hostEvent('anything.test')) as Record<string, unknown>
    expect(res.needsSetup).toBe(false)
  })

  it('refuses the setup wizard, which would otherwise make the first visitor super admin', async () => {
    setPool('clientx')
    const event = createMockEvent({
      method: 'POST',
      headers: { host: 'anything.test' },
      body: { site: { name: 'Mine' }, admin: { name: 'Me', email: 'me@evil.test', password: 'password123' } },
    }) as unknown as H3Event
    await expect((setupComplete as Handler)(event)).rejects.toMatchObject({ statusCode: 403 })
    const users = await getCurrentTestDb().query.users.findMany()
    expect(users).toHaveLength(0)
  })

  it('still offers setup on an ordinary empty install', async () => {
    const res = await (setupStatus as Handler)(hostEvent('localhost')) as Record<string, unknown>
    expect(res.needsSetup).toBe(true)
  })

  it('answers "Site not found" for any address while it has no sites', async () => {
    setPool('clientx')
    const event = hostEvent('anything.test')
    const res = await (multiSiteMiddleware as unknown as Handler)(event)
    expect(status(event)).toBe(404)
    expect(String(res)).toContain('Site not found')
  })
})

describe('a pool only serves its sites\' own addresses', () => {
  const SITE = 'site-pool-client'

  beforeAll(async () => {
    await seedSite(getCurrentTestDb(), { id: SITE, domain: 'client.example', setupCompleted: true })
  })

  it('serves a site on its own domain', async () => {
    setPool('clientx')
    const event = hostEvent('client.example')
    await (multiSiteMiddleware as unknown as Handler)(event)
    expect(ctx(event).siteId).toBe(SITE)
  })

  it('does not hand a stray address to its only site', async () => {
    setPool('clientx')
    const event = hostEvent('clientx-pool.workers.dev', '/admin')
    await (multiSiteMiddleware as unknown as Handler)(event)
    expect(status(event)).toBe(404)
    expect(ctx(event).siteId).toBeNull()
  })

  it('where an ordinary install with one site would still fall back to it', async () => {
    const event = hostEvent('my-worker.workers.dev')
    await (multiSiteMiddleware as unknown as Handler)(event)
    expect(ctx(event).siteId).toBe(SITE)
  })

  it('is never the accounts domain, even if that hostname is routed to it', () => {
    setPool('clientx')
    expect(isAccountsHost(hostEvent('accounts.platform.test'))).toBe(false)
  })

  it('counts as a hosting platform, without a primary site to hold the switch', async () => {
    expect(await isHostingPlatform(getCurrentTestDb())).toBe(false)
    setPool('clientx')
    expect(await isHostingPlatform(getCurrentTestDb())).toBe(true)
  })
})

describe('control-plane-only actions are refused in a pool', () => {
  const routes = [
    ['POST /api/v1/admin/sites', '../../server/api/v1/admin/sites/index.post'],
    ['PATCH /api/v1/admin/sites/:id', '../../server/api/v1/admin/sites/[id].patch'],
    ['DELETE /api/v1/admin/sites/:id', '../../server/api/v1/admin/sites/[id].delete'],
    ['POST /api/v1/users/:id/super-admin', '../../server/api/v1/users/[id]/super-admin.post'],
    ['DELETE /api/v1/users/:id/super-admin', '../../server/api/v1/users/[id]/super-admin.delete'],
    ['PUT /api/v1/admin/platform', '../../server/api/v1/admin/platform/index.put'],
    ['POST /api/v1/admin/plans', '../../server/api/v1/admin/plans/index.post'],
    ['PATCH /api/v1/admin/plans/:id', '../../server/api/v1/admin/plans/[id].patch'],
    ['DELETE /api/v1/admin/plans/:id', '../../server/api/v1/admin/plans/[id].delete'],
  ] as const

  it.each(routes)('%s', async (_name, path) => {
    const { default: handler } = await import(path)
    setPool('clientx')
    const event = createMockEvent({ session: { user: { id: 'anyone', name: 'A', email: 'a@x.test' } }, params: { id: 'x' } }) as unknown as H3Event
    await expect((handler as Handler)(event)).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/control panel/) })
  })

  it('a site\'s domain can\'t be changed in Settings either', async () => {
    const db = getCurrentTestDb()
    const SITE = 'site-pool-settings'
    await seedSite(db, { id: SITE, domain: 'settings.example', setupCompleted: true })
    const admin = await seedUser(db, { email: 'admin@pool.test' })
    await seedRole(db, admin, SITE, 'admin')
    const { default: patchSettings } = await import('../../server/api/v1/settings/index.patch')
    setPool('clientx')
    const event = createMockEvent({
      siteId: SITE,
      method: 'PATCH',
      session: { user: { id: admin, name: 'A', email: 'admin@pool.test' } },
      body: { domain: 'elsewhere.example' },
    }) as unknown as H3Event
    await expect((patchSettings as Handler)(event)).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/control panel/) })
  })
})

describe('platform settings', () => {
  const PRIMARY = 'site-pool-primary'

  beforeAll(async () => {
    await seedSite(getCurrentTestDb(), { id: PRIMARY, domain: 'operator.example', isPrimary: true, setupCompleted: true })
    await seedSetting(getCurrentTestDb(), PRIMARY, AI_DAILY_CAP_SETTING_KEY, '500')
  })

  it('lists every key pool sites read', () => {
    expect(Object.keys(POOL_PLATFORM_SETTINGS)).toEqual(expect.arrayContaining([AI_DAILY_CAP_SETTING_KEY, ANALYTICS_TOKEN_KEY]))
  })

  it('come from the primary site on the control plane', async () => {
    expect(await getAiDailyCap(getCurrentTestDb())).toBe(500)
  })

  it('come from what the control plane sent in a pool, never from a local primary site', async () => {
    const db = getCurrentTestDb()
    setPool('clientx')
    expect(await getAiDailyCap(db)).toBeNull()

    await storePlatformSettings(db, { [AI_DAILY_CAP_SETTING_KEY]: '40', [ANALYTICS_TOKEN_KEY]: 'cf-token-123' })
    clearAiDailyCapCache()
    expect(await getAiDailyCap(db)).toBe(40)
    expect(await getPlatformSetting(db, ANALYTICS_TOKEN_KEY)).toBe('cf-token-123')

    // The token is stored encrypted, like a sensitive site setting.
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, ANALYTICS_TOKEN_KEY))
    expect(row?.value).not.toContain('cf-token-123')

    await storePlatformSettings(db, { [ANALYTICS_TOKEN_KEY]: null })
    expect(await getPlatformSetting(db, ANALYTICS_TOKEN_KEY)).toBeNull()
  })

  it('only accepts platform settings', async () => {
    await expect(storePlatformSettings(getCurrentTestDb(), { 'payments.stripe_secret_key': 'sk_live' })).rejects.toThrow(/Not a platform setting/)
  })
})
