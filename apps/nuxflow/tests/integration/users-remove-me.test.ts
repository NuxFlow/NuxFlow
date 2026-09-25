/**
 * Integration tests for DELETE /api/v1/users/:id (remove from site) and
 * GET /api/v1/users/me (client-side role source of truth).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { userSiteRoles, users, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: removeHandler } = await import('../../server/api/v1/users/[id].delete')
const { default: meHandler } = await import('../../server/api/v1/users/me.get')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-users-rm-01'
const OTHER = 'site-users-rm-02'

let adminId: string
let editorId: string
let superId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'rm.localhost' })
  await seedSite(db, { id: OTHER, domain: 'rm2.localhost' })
  adminId = await seedUser(db, { email: 'admin@rm.test' })
  editorId = await seedUser(db, { email: 'editor@rm.test' })
  superId = await seedUser(db, { email: 'super@rm.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, superId, SITE, 'super_admin')
})

afterAll(teardownTestDb)

function ev(userId: string, opts: { siteId?: string; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: { user: { id: userId, name: 'U', email: 'u@example.com' } },
    params: opts.params,
  }) as unknown as H3Event
}

async function roleOf(userId: string, siteId = SITE) {
  const db = getCurrentTestDb()
  const row = await db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.siteId, siteId)),
  })
  return row?.role ?? null
}

describe('DELETE /api/v1/users/:id', () => {
  it('forbids an editor', async () => {
    await expect((removeHandler as Handler)(ev(editorId, { params: { id: adminId } })))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses self-removal', async () => {
    await expect((removeHandler as Handler)(ev(adminId, { params: { id: adminId } })))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(await roleOf(adminId)).toBe('admin')
  })

  it('refuses to remove a super admin', async () => {
    await expect((removeHandler as Handler)(ev(adminId, { params: { id: superId } })))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(await roleOf(superId)).toBe('super_admin')
  })

  it('404s for a user with no role on this site', async () => {
    const db = getCurrentTestDb()
    const elsewhere = await seedUser(db, { email: 'elsewhere@rm.test' })
    await seedRole(db, elsewhere, OTHER, 'editor')
    await expect((removeHandler as Handler)(ev(adminId, { params: { id: elsewhere } })))
      .rejects.toMatchObject({ statusCode: 404 })
    expect(await roleOf(elsewhere, OTHER)).toBe('editor')
  })

  it('removes only this site\'s role, keeps the account and other sites\' roles, and audits', async () => {
    const db = getCurrentTestDb()
    const target = await seedUser(db, { email: 'target@rm.test' })
    await seedRole(db, target, SITE, 'author')
    await seedRole(db, target, OTHER, 'author')

    const event = ev(adminId, { params: { id: target } })
    await (removeHandler as Handler)(event)
    expect((event as unknown as { _status: number })._status).toBe(204)

    expect(await roleOf(target)).toBeNull()
    expect(await roleOf(target, OTHER)).toBe('author')
    expect(await db.query.users.findFirst({ where: eq(users.id, target) })).toBeDefined()

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.resource, 'user'), eq(auditLogs.resourceId, target), eq(auditLogs.action, 'delete')),
    })
    expect(log?.before).toMatchObject({ role: 'author' })
  })

  it('takes effect immediately for the removed user (role cache cleared)', async () => {
    const db = getCurrentTestDb()
    const target = await seedUser(db, { email: 'cached@rm.test' })
    await seedRole(db, target, SITE, 'editor')
    // Warm the role cache via /me, then remove.
    expect(await (meHandler as Handler)(ev(target))).toMatchObject({ role: 'editor' })
    await (removeHandler as Handler)(ev(adminId, { params: { id: target } }))
    expect(await (meHandler as Handler)(ev(target))).toMatchObject({ role: null })
  })
})

describe('GET /api/v1/users/me', () => {
  it('401s without a session', async () => {
    const event = createMockEvent({ siteId: SITE, session: null }) as unknown as H3Event
    await expect((meHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns the real per-site role', async () => {
    expect(await (meHandler as Handler)(ev(editorId))).toEqual({ role: 'editor', isSuperAdmin: false })
  })

  it('reports isSuperAdmin only on the site holding the grant', async () => {
    expect(await (meHandler as Handler)(ev(superId))).toEqual({ role: 'super_admin', isSuperAdmin: true })
    // Cross-site: viewer fallback, but no super-admin UI.
    expect(await (meHandler as Handler)(ev(superId, { siteId: OTHER }))).toEqual({ role: 'viewer', isSuperAdmin: false })
  })

  it('returns role: null for a stranger rather than a fabricated viewer', async () => {
    const db = getCurrentTestDb()
    const stranger = await seedUser(db, { email: 'stranger@rm.test' })
    expect(await (meHandler as Handler)(ev(stranger))).toEqual({ role: null, isSuperAdmin: false })
  })
})
