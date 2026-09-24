/**
 * Integration tests for server/middleware/02.multi-site.ts — resolves the current site
 * from the Host header, sets event.context.{siteId, siteStatus, setupCompleted}, handles
 * maintenance mode, suspended-site blocking, and the single-site fallback.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import multiSiteMiddleware from '../../server/middleware/02.multi-site'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE_A = 'site-mw-a'
const SITE_B = 'site-mw-maint'
const SITE_C = 'site-mw-suspended'

type MiddlewareFn = (e: H3Event) => Promise<unknown>

/**
 * Creates a mock event with `path` exposed as a direct property so the
 * multi-site middleware can read `event.path` without going through a helper.
 */
function mkSiteEvent(opts: { host?: string; path?: string } = {}) {
  const base = createMockEvent({
    headers: opts.host ? { host: opts.host } : {},
  }) as unknown as Record<string, unknown>

  // The middleware reads event.path directly — it's not exposed by createMockEvent
  base.path = opts.path ?? '/'

  return base as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE_A, domain: 'site-a.localhost', status: 'active', setupCompleted: true })
  await seedSite(db, { id: SITE_B, domain: 'site-b.localhost', status: 'maintenance', setupCompleted: true })
  await seedSite(db, { id: SITE_C, domain: 'site-c.localhost', status: 'suspended', setupCompleted: true })
})

afterAll(teardownTestDb)

describe('02.multi-site middleware', () => {
  it('resolves siteId from the Host header (exact domain match)', async () => {
    const event = mkSiteEvent({ host: 'site-a.localhost', path: '/some-page' })
    await (multiSiteMiddleware as MiddlewareFn)(event)
    expect((event as unknown as { context: { siteId: string } }).context.siteId).toBe(SITE_A)
  })

  it('sets siteStatus and setupCompleted alongside siteId', async () => {
    const event = mkSiteEvent({ host: 'site-a.localhost', path: '/' })
    await (multiSiteMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.siteStatus).toBe('active')
    expect(ctx.setupCompleted).toBe(true)
  })

  it('sets siteId to null when the host does not match and multiple sites exist', async () => {
    const event = mkSiteEvent({ host: 'completely-unknown.host', path: '/' })
    await (multiSiteMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context

    // Two sites exist → no fallback → null
    expect(ctx.siteId).toBeNull()
  })

  it('bypasses DB lookup for /api/v1/setup paths', async () => {
    const event = mkSiteEvent({ host: 'unknown-host.localhost', path: '/api/v1/setup/complete' })
    // Should return early without throwing, leaving siteId as whatever was in context
    const result = await (multiSiteMiddleware as MiddlewareFn)(event)
    expect(result).toBeUndefined()
  })

  it('bypasses DB lookup for /api/auth paths', async () => {
    const event = mkSiteEvent({ host: 'unknown-host.localhost', path: '/api/auth/session' })
    const result = await (multiSiteMiddleware as MiddlewareFn)(event)
    expect(result).toBeUndefined()
  })

  it('returns maintenance HTML for public paths when site is in maintenance mode', async () => {
    const event = mkSiteEvent({ host: 'site-b.localhost', path: '/my-page' })
    const result = await (multiSiteMiddleware as MiddlewareFn)(event) as string

    expect(typeof result).toBe('string')
    expect(result).toContain('Down for maintenance')
    expect((event as unknown as { _status: number })._status).toBe(503)
  })

  it('does not intercept /admin paths during maintenance mode', async () => {
    const event = mkSiteEvent({ host: 'site-b.localhost', path: '/admin/dashboard' })
    const result = await (multiSiteMiddleware as MiddlewareFn)(event)

    // Admin path should not return the maintenance page (returns undefined to pass through)
    expect(result).toBeUndefined()
    expect((event as unknown as { _status?: number })._status).not.toBe(503)
  })

  it('does not intercept /api paths during maintenance mode', async () => {
    const event = mkSiteEvent({ host: 'site-b.localhost', path: '/api/v1/content' })
    const result = await (multiSiteMiddleware as MiddlewareFn)(event)
    expect(result).toBeUndefined()
  })

  describe('suspended site — blocks everything except a super admin', () => {
    let suspendedSuperAdmin: string

    beforeAll(async () => {
      // Super admin status is granted on SITE_A (cross-site by design — see
      // hasSuperAdminRole/requireSuperAdmin) rather than on the suspended site itself,
      // to exercise the actual real-world case: an operator managing a suspended site
      // from their own super-admin grant elsewhere, not a role row on that site.
      suspendedSuperAdmin = await seedUser(getCurrentTestDb(), { email: 'suspended-super@middleware.test' })
      await seedRole(getCurrentTestDb(), suspendedSuperAdmin, SITE_A, 'super_admin')
    })

    it('returns a 403 suspended page for public paths', async () => {
      const event = mkSiteEvent({ host: 'site-c.localhost', path: '/my-page' })
      const result = await (multiSiteMiddleware as MiddlewareFn)(event) as string

      expect(typeof result).toBe('string')
      expect(result).toContain('Site suspended')
      expect((event as unknown as { _status: number })._status).toBe(403)
    })

    it('blocks /admin paths for an unauthenticated visitor', async () => {
      const event = mkSiteEvent({ host: 'site-c.localhost', path: '/admin/dashboard' })
      const result = await (multiSiteMiddleware as MiddlewareFn)(event)
      expect(result).toContain('Site suspended')
      expect((event as unknown as { _status: number })._status).toBe(403)
    })

    it('blocks /admin paths for an authenticated non-super-admin', async () => {
      const nonSuperAdmin = await seedUser(getCurrentTestDb(), { email: 'suspended-nonsuper@middleware.test' })
      await seedRole(getCurrentTestDb(), nonSuperAdmin, SITE_A, 'admin')

      const event = mkSiteEvent({ host: 'site-c.localhost', path: '/admin/dashboard' }) as unknown as
        { context: Record<string, unknown> }
      event.context._session = { user: { id: nonSuperAdmin } }
      const result = await (multiSiteMiddleware as MiddlewareFn)(event as unknown as H3Event)
      expect(result).toContain('Site suspended')
    })

    it('blocks /api paths with a JSON error for an unauthenticated request', async () => {
      const event = mkSiteEvent({ host: 'site-c.localhost', path: '/api/v1/content' })
      const result = await (multiSiteMiddleware as MiddlewareFn)(event) as { statusCode: number }
      expect(result).toMatchObject({ statusCode: 403 })
    })

    it('lets a super admin (with no role row on the suspended site itself) through to /admin', async () => {
      const event = mkSiteEvent({ host: 'site-c.localhost', path: '/admin/dashboard' }) as unknown as
        { context: Record<string, unknown> }
      event.context._session = { user: { id: suspendedSuperAdmin } }
      const result = await (multiSiteMiddleware as MiddlewareFn)(event as unknown as H3Event)
      expect(result).toBeUndefined()
      expect((event as unknown as { _status?: number })._status).not.toBe(403)
    })

    it('lets a super admin through to /api on the suspended site', async () => {
      const event = mkSiteEvent({ host: 'site-c.localhost', path: '/api/v1/content' }) as unknown as
        { context: Record<string, unknown> }
      event.context._session = { user: { id: suspendedSuperAdmin } }
      const result = await (multiSiteMiddleware as MiddlewareFn)(event as unknown as H3Event)
      expect(result).toBeUndefined()
    })
  })

  describe('single-site fallback self-heal (exactly one site in the DB)', () => {
    let adminUserId: string

    // Isolate this block to exactly one site by temporarily removing SITE_B and SITE_C —
    // the self-heal write only fires when the fallback matched exactly one site.
    beforeAll(async () => {
      await getCurrentTestDb().delete(sites).where(eq(sites.id, SITE_B))
      await getCurrentTestDb().delete(sites).where(eq(sites.id, SITE_C))
      adminUserId = await seedUser(getCurrentTestDb(), { email: 'self-heal-admin@middleware.test' })
      await seedRole(getCurrentTestDb(), adminUserId, SITE_A, 'admin')
    })

    afterAll(async () => {
      await seedSite(getCurrentTestDb(), { id: SITE_B, domain: 'site-b.localhost', status: 'maintenance', setupCompleted: true })
      await seedSite(getCurrentTestDb(), { id: SITE_C, domain: 'site-c.localhost', status: 'suspended', setupCompleted: true })
    })

    it('does NOT rewrite the site domain on /admin paths without an authenticated admin session', async () => {
      // `Host` is fully attacker-controlled on a Worker with no custom-domain route
      // configured — without a session check, this exact request (an unauthenticated
      // hit on /admin with a forged Host header) used to silently steal the site's
      // domain out from under its real one.
      const event = mkSiteEvent({ host: 'attacker-domain.localhost', path: '/admin/settings' })
      await (multiSiteMiddleware as MiddlewareFn)(event)
      const ctx = (event as unknown as { context: Record<string, unknown> }).context
      expect(ctx.siteId).toBe(SITE_A)

      const row = await getCurrentTestDb().query.sites.findFirst({ where: eq(sites.id, SITE_A) })
      expect(row?.domain).toBe('site-a.localhost')
    })

    it('rewrites the site domain on an unmatched host for /admin paths when signed in as an admin on this site', async () => {
      const event = mkSiteEvent({ host: 'new-domain.localhost', path: '/admin/settings' }) as unknown as
        { context: Record<string, unknown> }
      event.context._session = { user: { id: adminUserId } }
      await (multiSiteMiddleware as MiddlewareFn)(event as unknown as H3Event)
      const ctx = event.context
      expect(ctx.siteId).toBe(SITE_A)

      const row = await getCurrentTestDb().query.sites.findFirst({ where: eq(sites.id, SITE_A) })
      expect(row?.domain).toBe('new-domain.localhost')

      // Restore for the next test in this block
      await getCurrentTestDb().update(sites).set({ domain: 'site-a.localhost' }).where(eq(sites.id, SITE_A))
    })

    it('does NOT rewrite the site domain on an unmatched host for public paths (e.g. a crawler hitting an unrelated domain)', async () => {
      const event = mkSiteEvent({ host: 'some-crawler-hit.localhost', path: '/robots.txt' })
      await (multiSiteMiddleware as MiddlewareFn)(event)
      const ctx = (event as unknown as { context: Record<string, unknown> }).context

      // Still served via fallback so the request doesn't 404 outright...
      expect(ctx.siteId).toBe(SITE_A)

      // ...but the real domain must be left untouched.
      const row = await getCurrentTestDb().query.sites.findFirst({ where: eq(sites.id, SITE_A) })
      expect(row?.domain).toBe('site-a.localhost')
    })
  })
})
