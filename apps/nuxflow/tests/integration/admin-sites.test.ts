/**
 * Integration tests for the super-admin site management API
 * (server/api/v1/admin/sites/*) and GET /api/v1/admin/db-stats.
 *
 * Behaviour under test:
 *  - Every route is gated by requireSuperAdmin — site-scoped, so an admin (or a
 *    super admin whose grant is on a *different* site) is rejected.
 *  - POST returns a one-time setup token and persists only its SHA-256 hash.
 *  - Audit rows land on the *target* site, not the caller's current one.
 *  - DELETE refuses to delete the site the request arrived on.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { sites, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/media-providers/index', () => ({
  getActiveProvider: vi.fn(),
}))
vi.mock('../../server/utils/cf-theme-kv', () => ({
  deleteThemeCSS: vi.fn().mockResolvedValue(undefined),
  deleteThemeDemo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/cf-plugin-kv', () => ({
  deletePluginAssets: vi.fn().mockResolvedValue(undefined),
}))

const { mockGetD1SizeStats } = vi.hoisted(() => ({ mockGetD1SizeStats: vi.fn() }))
vi.mock('../../server/utils/d1-stats', () => ({
  getD1SizeStats: mockGetD1SizeStats,
  D1_PAID_PLAN_SIZE_CAP_BYTES: 10 * 1024 ** 3,
}))

const { default: listHandler } = await import('../../server/api/v1/admin/sites/index.get')
const { default: createHandler } = await import('../../server/api/v1/admin/sites/index.post')
const { default: patchHandler } = await import('../../server/api/v1/admin/sites/[id].patch')
const { default: deleteHandler } = await import('../../server/api/v1/admin/sites/[id].delete')
const { default: dbStatsHandler } = await import('../../server/api/v1/admin/db-stats.get')

type Handler = (e: H3Event) => Promise<unknown>

const PRIMARY = 'site-admin-sites-primary'
const TENANT = 'site-admin-sites-tenant'

let superId: string
let adminId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'primary.localhost' })
  await seedSite(db, { id: TENANT, domain: 'tenant.localhost' })

  superId = await seedUser(db, { email: 'super@admin-sites.test' })
  adminId = await seedUser(db, { email: 'admin@admin-sites.test' })
  await seedRole(db, superId, PRIMARY, 'super_admin')
  await seedRole(db, adminId, PRIMARY, 'admin')
})

afterAll(teardownTestDb)

function ev(userId: string, opts: { siteId?: string; body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? PRIMARY,
    session: { user: { id: userId, name: 'U', email: 'u@example.com' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

describe('requireSuperAdmin gate', () => {
  it('rejects a site admin on every route', async () => {
    const e = () => ev(adminId, { body: { name: 'X', domain: 'x.localhost' }, params: { id: TENANT } })
    for (const h of [listHandler, createHandler, patchHandler, deleteHandler, dbStatsHandler]) {
      await expect((h as Handler)(e())).rejects.toMatchObject({ statusCode: 403 })
    }
  })

  it('rejects a super admin acting from a domain where they hold no super_admin grant', async () => {
    // Site-scoped: a super_admin grant on PRIMARY does not authorize platform
    // actions driven from TENANT's domain (see requireSuperAdmin in permissions.ts).
    await expect((listHandler as Handler)(ev(superId, { siteId: TENANT }))).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('GET /api/v1/admin/sites', () => {
  it('lists every site across the installation', async () => {
    const res = await (listHandler as Handler)(ev(superId)) as { sites: { id: string }[] }
    const ids = res.sites.map(s => s.id)
    expect(ids).toEqual(expect.arrayContaining([PRIMARY, TENANT]))
  })
})

describe('POST /api/v1/admin/sites', () => {
  it('creates an un-setup site, returns a raw setup token, and stores only its hash', async () => {
    const event = ev(superId, { body: { name: 'New Tenant', domain: 'new.localhost' } })
    const res = await (createHandler as Handler)(event) as { id: string; setupToken: string }

    expect((event as unknown as { _status: number })._status).toBe(201)
    expect(res.setupToken).toMatch(/^[\w-]{40,}$/)

    const db = getCurrentTestDb()
    const row = await db.query.sites.findFirst({ where: eq(sites.id, res.id) })
    expect(row?.setupCompleted).toBe(false)
    expect(row?.locale).toBe('en')
    expect(row?.timezone).toBe('UTC')
    expect(row?.setupTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.setupTokenHash).not.toContain(res.setupToken)

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(res.setupToken))
    const expected = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
    expect(row?.setupTokenHash).toBe(expected)
  })

  it('writes the audit row against the new site, not the caller\'s current site', async () => {
    const res = await (createHandler as Handler)(ev(superId, { body: { name: 'Audited', domain: 'audited.localhost' } })) as { id: string }
    const db = getCurrentTestDb()
    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.resource, 'site'), eq(auditLogs.resourceId, res.id)),
    })
    expect(log?.siteId).toBe(res.id)
    expect(log?.action).toBe('create')
    expect(log?.userId).toBe(superId)
  })

  it('issues a different token every time', async () => {
    const a = await (createHandler as Handler)(ev(superId, { body: { name: 'A', domain: 'a.localhost' } })) as { setupToken: string }
    const b = await (createHandler as Handler)(ev(superId, { body: { name: 'B', domain: 'b.localhost' } })) as { setupToken: string }
    expect(a.setupToken).not.toBe(b.setupToken)
  })

  it('rejects an empty name with 422', async () => {
    await expect((createHandler as Handler)(ev(superId, { body: { name: '', domain: 'z.localhost' } })))
      .rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('PATCH /api/v1/admin/sites/:id', () => {
  it('updates status and records before/after on the target site\'s audit log', async () => {
    await (patchHandler as Handler)(ev(superId, { params: { id: TENANT }, body: { status: 'suspended' } }))

    const db = getCurrentTestDb()
    const row = await db.query.sites.findFirst({ where: eq(sites.id, TENANT) })
    expect(row?.status).toBe('suspended')

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.resource, 'site'), eq(auditLogs.resourceId, TENANT), eq(auditLogs.action, 'update')),
    })
    expect(log?.siteId).toBe(TENANT)
    expect(log?.before).toMatchObject({ status: 'active' })
    expect(log?.after).toMatchObject({ status: 'suspended' })
  })

  it('rejects an unknown status value', async () => {
    await expect((patchHandler as Handler)(ev(superId, { params: { id: TENANT }, body: { status: 'deleted' } })))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('404s for an unknown site', async () => {
    await expect((patchHandler as Handler)(ev(superId, { params: { id: 'nope' }, body: { name: 'x' } })))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('DELETE /api/v1/admin/sites/:id', () => {
  it('refuses to delete the site the request arrived on', async () => {
    await expect((deleteHandler as Handler)(ev(superId, { params: { id: PRIMARY } })))
      .rejects.toMatchObject({ statusCode: 409 })
    const db = getCurrentTestDb()
    expect(await db.query.sites.findFirst({ where: eq(sites.id, PRIMARY) })).toBeDefined()
  })

  it('deletes another site and returns 204', async () => {
    const db = getCurrentTestDb()
    const doomed = await seedSite(db, { domain: 'doomed.localhost' })
    const event = ev(superId, { params: { id: doomed } })
    const res = await (deleteHandler as Handler)(event)
    expect(res).toBeNull()
    expect((event as unknown as { _status: number })._status).toBe(204)
    expect(await db.query.sites.findFirst({ where: eq(sites.id, doomed) })).toBeUndefined()
  })
})

describe('GET /api/v1/admin/db-stats', () => {
  it('returns stats plus the paid-plan cap', async () => {
    mockGetD1SizeStats.mockResolvedValueOnce({ approxDatabaseSizeBytes: 1234, sites: [] })
    const res = await (dbStatsHandler as Handler)(ev(superId)) as Record<string, unknown>
    expect(res).toMatchObject({ approxDatabaseSizeBytes: 1234, paidPlanSizeCapBytes: 10 * 1024 ** 3 })
  })

  it('turns a stats failure into a labelled 500', async () => {
    mockGetD1SizeStats.mockRejectedValueOnce(new Error('D1_ERROR: boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect((dbStatsHandler as Handler)(ev(superId))).rejects.toMatchObject({ statusCode: 500 })
    spy.mockRestore()
  })
})
