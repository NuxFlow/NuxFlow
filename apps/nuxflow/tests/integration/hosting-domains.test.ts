/**
 * Customers' own domains on a hosting platform (server/utils/hosting-domains.ts):
 * connecting one through Cloudflare for SaaS (faked here), checking it, the owner being
 * told once it works, making it the main address, extra addresses redirecting to the main
 * one (02.multi-site.ts), removing, plan allowances, and site deletion cleaning up.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { hostingPlans, hostingSubscriptions, notifications, siteDomains, sites } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({ api: { sendVerificationEmail: vi.fn() } }),
  clearBetterAuthCache: () => {},
}))
vi.mock('../../server/utils/accounts-origin', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCentralAuth: () => true,
  isAccountsHost: (event: { _headers?: Record<string, string> }) => event._headers?.host === 'accounts.platform.test',
  getAccountsHost: () => 'accounts.platform.test',
  accountsUrl: (path: string) => `https://accounts.platform.test${path}`,
}))

// ── A fake Cloudflare for SaaS API ─────────────────────────────────────────────
const cloudflare = {
  hostnames: new Map<string, { id: string, hostname: string, status: string, ssl: { status: string } }>(),
  calls: [] as { method: string, url: string, body?: unknown }[],
}
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  cloudflare.calls.push({ method, url, body })
  const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result, errors: [] }), { status: 200 })
  const id = url.split('/custom_hostnames/')[1]
  if (method === 'POST') {
    if ([...cloudflare.hostnames.values()].some(h => h.hostname === body.hostname)) {
      return new Response(JSON.stringify({ success: false, errors: [{ code: 1406, message: 'Duplicate custom hostname found.' }] }), { status: 409 })
    }
    const h = { id: `cf_${cloudflare.hostnames.size + 1}`, hostname: body.hostname, status: 'pending', ssl: { status: 'pending_validation' } }
    cloudflare.hostnames.set(h.id, h)
    return ok(h)
  }
  if (method === 'GET') return ok(cloudflare.hostnames.get(id!))
  if (method === 'DELETE') {
    cloudflare.hostnames.delete(id!)
    return ok({ id })
  }
  return new Response('{}', { status: 400 })
})
vi.stubGlobal('fetch', fetchMock)
const goLive = (hostname: string) => {
  const h = [...cloudflare.hostnames.values()].find(x => x.hostname === hostname)!
  h.status = 'active'
  h.ssl.status = 'active'
}

const realRuntimeConfig = globalThis.useRuntimeConfig
globalThis.useRuntimeConfig = (() => ({ ...realRuntimeConfig(), hostingSitesDomain: 'sites.test' })) as typeof globalThis.useRuntimeConfig

const { customDomainProblem, checkPendingCustomDomains } = await import('../../server/utils/hosting-domains')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { clearHostingPlanCache } = await import('../../server/utils/hosting-plans')
const { hostingSenderDomainForSite } = await import('../../server/utils/email')
const { default: multiSite } = await import('../../server/middleware/02.multi-site')
const { clearSiteCache } = await import('../../server/utils/site-resolution')
const { default: listDomains } = await import('../../server/api/accounts/hosting/domains/index.get')
const { default: addDomain } = await import('../../server/api/accounts/hosting/domains/index.post')
const { default: checkDomain } = await import('../../server/api/accounts/hosting/domains/check.post')
const { default: makeMain } = await import('../../server/api/accounts/hosting/domains/primary.post')
const { default: removeDomain } = await import('../../server/api/accounts/hosting/domains/index.delete')
const { default: patchSite } = await import('../../server/api/v1/admin/sites/[id].patch')
const { deleteSiteCompletely } = await import('../../server/utils/site-deletion')

type Handler = (e: H3Event) => Promise<unknown>
interface Panel { available: boolean, target: string, allowed: number | null, used: number, domains: { hostname: string, kind: string, main: boolean, live: boolean }[] }

const PRIMARY = 'site-dom-primary'
const CAFE = 'site-dom-cafe'
const SUB = 'sub-dom-cafe'
let operatorId: string
let ownerId: string
let otherId: string
let planId: string

const owner = () => ({ user: { id: ownerId, name: 'Owner', email: 'owner@dom.test' } })
function onAccounts(opts: Parameters<typeof createMockEvent>[0] = {}): H3Event {
  return createMockEvent({ siteId: undefined, headers: { host: 'accounts.platform.test' }, ...opts }) as unknown as H3Event
}
const call = (handler: unknown, body: Record<string, unknown> = {}, session = owner()) =>
  (handler as Handler)(onAccounts({ method: 'POST', session, body: { id: SUB, ...body }, query: { id: SUB } })) as Promise<Panel>

/** Runs the site-resolving middleware for a request to `host`. */
async function visit(host: string, path = '/about', method = 'GET') {
  const event = createMockEvent({ siteId: undefined, headers: { host } }) as unknown as Record<string, unknown>
  event._path = path
  event.method = method
  await (multiSite as Handler)(event as unknown as H3Event)
  return event as unknown as { context: { siteId: string | null }, _redirect?: { url: string, code: number } }
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, name: 'Platform' })
  operatorId = await seedUser(db, { email: 'op@dom.test' })
  ownerId = await seedUser(db, { email: 'owner@dom.test', name: 'Owner' })
  otherId = await seedUser(db, { email: 'other@dom.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  await seedSetting(db, PRIMARY, 'hosting.cf_zone_id', 'a'.repeat(32))
  await seedSetting(db, PRIMARY, 'hosting.cf_api_token', 'test-token')
})

afterAll(async () => {
  globalThis.useRuntimeConfig = realRuntimeConfig
  vi.unstubAllGlobals()
  await teardownTestDb()
})

beforeEach(async () => {
  const db = getCurrentTestDb()
  await db.delete(siteDomains)
  await db.delete(hostingSubscriptions)
  await db.delete(notifications)
  await db.delete(sites).where(eq(sites.id, CAFE))
  await db.delete(hostingPlans)
  planId = ulid()
  await db.insert(hostingPlans).values({ id: planId, name: 'Business', maxCustomDomains: 2 })
  await seedSite(db, { id: CAFE, domain: 'cafe.sites.test', name: 'The Café', hostingPlanId: planId })
  await seedRole(db, ownerId, CAFE, 'admin')
  await db.insert(hostingSubscriptions).values({ id: SUB, ownerUserId: ownerId, planId, interval: 'month', status: 'active', requestedSubdomain: 'cafe', requestedSiteName: 'The Café', hostedSiteId: CAFE })
  cloudflare.hostnames.clear()
  cloudflare.calls = []
  clearSiteCache()
  clearHostingPlatformCache()
  clearHostingPlanCache()
})

describe('which domains can be connected', () => {
  const own = { sitesDomain: 'sites.test', protectedHosts: ['platform.test', 'accounts.platform.test'] }
  it('refuses our own addresses, IPs and nonsense', () => {
    expect(customDomainProblem('www.cafe.co.uk', own)).toBeNull()
    expect(customDomainProblem('cafe.co.uk', own)).toBeNull()
    expect(customDomainProblem('other.sites.test', own)).toMatch(/our own/)
    expect(customDomainProblem('sites.test', own)).toMatch(/our own/)
    expect(customDomainProblem('evil.platform.test', own)).toMatch(/our own/)
    expect(customDomainProblem('1.2.3.4', own)).toMatch(/IP/)
    expect(customDomainProblem(null, own)).toBeTruthy()
    expect(customDomainProblem('x.workers.dev', own)).toBeTruthy()
  })
})

describe('connecting a domain', () => {
  it('registers it with Cloudflare (HTTP validation) and shows it waiting for DNS', async () => {
    const panel = await call(addDomain, { hostname: 'https://WWW.Cafe.co.uk/' })
    expect(cloudflare.calls[0]).toMatchObject({ method: 'POST', body: { hostname: 'www.cafe.co.uk', ssl: { method: 'http', type: 'dv' } } })
    expect(cloudflare.calls[0]!.url).toContain(`/zones/${'a'.repeat(32)}/custom_hostnames`)
    expect(panel).toMatchObject({ available: true, target: 'customers.sites.test', allowed: 2, used: 1 })
    expect(panel.domains).toEqual([
      expect.objectContaining({ hostname: 'cafe.sites.test', main: true }),
      expect.objectContaining({ hostname: 'www.cafe.co.uk', kind: 'custom', main: false, live: false }),
    ])
  })

  it("refuses a domain that's already connected, and goes over the plan's allowance", async () => {
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    await expect(call(addDomain, { hostname: 'www.cafe.co.uk' })).rejects.toMatchObject({ statusCode: 409 })
    await call(addDomain, { hostname: 'cafe.co.uk' })
    await expect(call(addDomain, { hostname: 'shop.cafe.co.uk' })).rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_limit' } })
  })

  it("is refused on a plan that doesn't include it, and when Cloudflare isn't set up", async () => {
    await getCurrentTestDb().update(hostingPlans).set({ maxCustomDomains: 0 }).where(eq(hostingPlans.id, planId))
    clearHostingPlanCache()
    await expect(call(addDomain, { hostname: 'www.cafe.co.uk' })).rejects.toMatchObject({ statusCode: 403 })
    expect(cloudflare.calls).toHaveLength(0)
  })

  it("only lets the site's owner manage its addresses", async () => {
    await expect(call(listDomains, {}, { user: { id: otherId, name: 'O', email: 'other@dom.test' } })).rejects.toMatchObject({ statusCode: 404 })
    await expect(call(addDomain, { hostname: 'www.cafe.co.uk' }, { user: { id: otherId, name: 'O', email: 'other@dom.test' } })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('once the DNS record is in place', () => {
  it('shows it as working after a check, and tells the owner and operator once', async () => {
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    let panel = await call(checkDomain, { hostname: 'www.cafe.co.uk' })
    expect(panel.domains[1]).toMatchObject({ live: false })

    goLive('www.cafe.co.uk')
    panel = await call(checkDomain, { hostname: 'www.cafe.co.uk' })
    expect(panel.domains[1]).toMatchObject({ live: true })
    await call(checkDomain, { hostname: 'www.cafe.co.uk' })
    const told = await getCurrentTestDb().select().from(notifications).where(eq(notifications.type, 'system.hosting'))
    expect(told.map(n => n.title)).toEqual(['Domain connected: www.cafe.co.uk'])
  })

  it('is checked hourly too', async () => {
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    goLive('www.cafe.co.uk')
    const event = createMockEvent({ siteId: PRIMARY, headers: { host: 'platform.test' } }) as unknown as H3Event
    expect(await checkPendingCustomDomains(event)).toEqual({ checked: 1, live: 1 })
    expect(await checkPendingCustomDomains(event)).toEqual({ checked: 0, live: 0 })
  })
})

describe('the main address and redirects', () => {
  it("won't switch to a domain that isn't working yet", async () => {
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    await expect(call(makeMain, { hostname: 'www.cafe.co.uk' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('switches, keeps the old address redirecting, and can switch back', async () => {
    const db = getCurrentTestDb()
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    // Before the switch, the new domain redirects to the original address.
    expect((await visit('www.cafe.co.uk'))._redirect).toEqual({ url: 'https://cafe.sites.test/about', code: 301 })

    goLive('www.cafe.co.uk')
    await call(checkDomain, { hostname: 'www.cafe.co.uk' })
    const panel = await call(makeMain, { hostname: 'www.cafe.co.uk' })
    expect(panel.domains.map(d => [d.hostname, d.main])).toEqual([['www.cafe.co.uk', true], ['cafe.sites.test', false]])
    expect((await db.query.sites.findFirst({ where: eq(sites.id, CAFE) }))!.domain).toBe('www.cafe.co.uk')

    const onMain = await visit('www.cafe.co.uk')
    expect(onMain.context.siteId).toBe(CAFE)
    expect(onMain._redirect).toBeUndefined()
    expect((await visit('cafe.sites.test', '/menu?x=1'))._redirect).toEqual({ url: 'https://www.cafe.co.uk/menu?x=1', code: 301 })
    expect((await visit('cafe.sites.test', '/api/v1/forms/x/submit', 'POST'))._redirect).toMatchObject({ code: 308 })
    expect((await visit('cafe.sites.test', '/.well-known/acme-challenge/abc'))._redirect).toBeUndefined()

    // Back to the original address: its "platform" row is used up, the custom row stays.
    await call(makeMain, { hostname: 'cafe.sites.test' })
    const rows = await db.select({ hostname: siteDomains.hostname, kind: siteDomains.kind }).from(siteDomains).where(eq(siteDomains.siteId, CAFE))
    expect(rows).toEqual([{ hostname: 'www.cafe.co.uk', kind: 'custom' }])
  })

  it("won't remove the main address; removing another also removes it from Cloudflare", async () => {
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    await expect(call(removeDomain, { hostname: 'cafe.sites.test' })).rejects.toMatchObject({ statusCode: 409 })
    const panel = await call(removeDomain, { hostname: 'www.cafe.co.uk' })
    expect(panel.domains).toHaveLength(1)
    expect(cloudflare.calls.at(-1)).toMatchObject({ method: 'DELETE' })
    expect(cloudflare.hostnames.size).toBe(0)
    expect((await visit('www.cafe.co.uk', '/'))._redirect).toBeUndefined()
  })
})

describe('everything else that depends on addresses', () => {
  it('a site that moved to its own domain still sends email from the shared sites domain', async () => {
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    goLive('www.cafe.co.uk')
    await call(checkDomain, { hostname: 'www.cafe.co.uk' })
    await call(makeMain, { hostname: 'www.cafe.co.uk' })
    const event = createMockEvent({ siteId: CAFE }) as unknown as H3Event
    expect(await hostingSenderDomainForSite(event, CAFE, 'www.cafe.co.uk')).toBe('sites.test')
    expect(await hostingSenderDomainForSite(event, PRIMARY, 'platform.test')).toBeNull()
  })

  it("a super admin can't give another site an address that's already connected", async () => {
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    const other = await seedSite(getCurrentTestDb(), { domain: 'other.sites.test' })
    await expect((patchSite as Handler)(createMockEvent({ siteId: PRIMARY, session: { user: { id: operatorId, name: 'Op', email: 'op@dom.test' } }, params: { id: other }, body: { domain: 'www.cafe.co.uk' } }) as unknown as H3Event))
      .rejects.toMatchObject({ statusCode: 409 })
    await getCurrentTestDb().delete(sites).where(eq(sites.id, other))
  })

  it("deleting a site removes its domains from Cloudflare", async () => {
    await call(addDomain, { hostname: 'www.cafe.co.uk' })
    await getCurrentTestDb().update(hostingSubscriptions).set({ status: 'canceled' }).where(and(eq(hostingSubscriptions.id, SUB)))
    await deleteSiteCompletely(createMockEvent({ siteId: PRIMARY, headers: { host: 'platform.test' } }) as unknown as H3Event, CAFE, operatorId)
    expect(cloudflare.hostnames.size).toBe(0)
  })
})
