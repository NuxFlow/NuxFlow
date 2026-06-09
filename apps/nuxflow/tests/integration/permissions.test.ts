import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { requireAuth, requireRole, requireSuperAdmin, roleAtLeast } from '../../server/utils/permissions'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-perms-01'

let adminUserId: string
let editorUserId: string
let noRoleUserId: string
let superAdminUserId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'perms.localhost' })

  adminUserId = await seedUser(db, { name: 'Admin', email: 'admin@perms.test' })
  editorUserId = await seedUser(db, { name: 'Editor', email: 'editor@perms.test' })
  noRoleUserId = await seedUser(db, { name: 'Norole', email: 'norole@perms.test' })
  superAdminUserId = await seedUser(db, { name: 'Super', email: 'super@perms.test' })

  await seedRole(db, adminUserId, SITE, 'admin')
  await seedRole(db, editorUserId, SITE, 'editor')
  // noRoleUserId has no role row — should default to 'viewer'
  await seedRole(db, superAdminUserId, SITE, 'super_admin')
})

afterAll(teardownTestDb)

// ---------------------------------------------------------------------------
// roleAtLeast (pure — no DB)
// ---------------------------------------------------------------------------

describe('roleAtLeast', () => {
  it('returns true when role rank is equal', () => {
    expect(roleAtLeast('admin', 'admin')).toBe(true)
  })

  it('returns true when role rank is higher', () => {
    expect(roleAtLeast('admin', 'editor')).toBe(true)
    expect(roleAtLeast('super_admin', 'viewer')).toBe(true)
  })

  it('returns false when role rank is lower', () => {
    expect(roleAtLeast('viewer', 'editor')).toBe(false)
    expect(roleAtLeast('member', 'admin')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe('requireAuth', () => {
  it('returns the userId and role when a valid session and role row exist', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: adminUserId, name: 'Admin', email: 'admin@perms.test' } },
    })

    const result = await requireAuth(event as unknown as H3Event)
    expect(result.userId).toBe(adminUserId)
    expect(result.role).toBe('admin')
  })

  it('defaults to viewer when no role row exists for the user', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: noRoleUserId, name: 'Norole', email: 'norole@perms.test' } },
    })

    const result = await requireAuth(event as unknown as H3Event)
    expect(result.role).toBe('viewer')
  })

  it('throws 401 when there is no session', async () => {
    const event = createMockEvent({ siteId: SITE, session: null })
    await expect(requireAuth(event as unknown as H3Event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 400 when the event has no siteId', async () => {
    const event = createMockEvent({
      session: { user: { id: adminUserId, name: 'Admin', email: 'admin@perms.test' } },
    })
    ;(event as { context: { siteId: string | undefined } }).context.siteId = undefined
    await expect(requireAuth(event as unknown as H3Event)).rejects.toMatchObject({ statusCode: 400 })
  })
})

// ---------------------------------------------------------------------------
// requireRole
// ---------------------------------------------------------------------------

describe('requireRole', () => {
  it('resolves when the user meets the minimum role', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: adminUserId, name: 'Admin', email: 'admin@perms.test' } },
    })

    const result = await requireRole(event as unknown as H3Event, 'editor')
    expect(result.role).toBe('admin')
  })

  it('throws 403 when the user is below the required role', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: editorUserId, name: 'Editor', email: 'editor@perms.test' } },
    })

    await expect(
      requireRole(event as unknown as H3Event, 'admin'),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows an exact role match', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: editorUserId, name: 'Editor', email: 'editor@perms.test' } },
    })

    const result = await requireRole(event as unknown as H3Event, 'editor')
    expect(result.role).toBe('editor')
  })
})

// ---------------------------------------------------------------------------
// requireSuperAdmin
// ---------------------------------------------------------------------------

describe('requireSuperAdmin', () => {
  it('resolves when the user has a super_admin role on any site', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: superAdminUserId, name: 'Super', email: 'super@perms.test' } },
    })

    const result = await requireSuperAdmin(event as unknown as H3Event)
    expect(result.userId).toBe(superAdminUserId)
  })

  it('throws 403 for a regular admin (not super_admin)', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: adminUserId, name: 'Admin', email: 'admin@perms.test' } },
    })

    await expect(
      requireSuperAdmin(event as unknown as H3Event),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 401 when not authenticated', async () => {
    const event = createMockEvent({ siteId: SITE, session: null })
    await expect(
      requireSuperAdmin(event as unknown as H3Event),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
