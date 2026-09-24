import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { requireAuth, requireRole, requireSuperAdmin, roleAtLeast, canEditContentItem } from '../../server/utils/permissions'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-perms-01'
const OTHER_SITE = 'site-perms-02'

let adminUserId: string
let editorUserId: string
let noRoleUserId: string
let superAdminUserId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'perms.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'perms2.localhost' })

  adminUserId = await seedUser(db, { name: 'Admin', email: 'admin@perms.test' })
  editorUserId = await seedUser(db, { name: 'Editor', email: 'editor@perms.test' })
  noRoleUserId = await seedUser(db, { name: 'Norole', email: 'norole@perms.test' })
  superAdminUserId = await seedUser(db, { name: 'Super', email: 'super@perms.test' })

  await seedRole(db, adminUserId, SITE, 'admin')
  await seedRole(db, editorUserId, SITE, 'editor')
  // noRoleUserId has no role row on either site — should now be rejected outright,
  // not silently downgraded to 'viewer' (see the comment in permissions.ts).
  // superAdminUserId has a super_admin row on SITE only — deliberately has no row
  // on OTHER_SITE, to exercise the preserved cross-site "still gets viewer" fallback.
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

  it('rejects a user with no role row on this site, even though they have an account', async () => {
    // User accounts are global across this multi-tenant install and login has no
    // site-membership check, so this must reject outright rather than silently
    // grant baseline 'viewer' access to a site this user was never invited to.
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: noRoleUserId, name: 'Norole', email: 'norole@perms.test' } },
    })

    await expect(requireAuth(event as unknown as H3Event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('still grants a super admin viewer-level access to a site they have no local role on', async () => {
    // Preserves the documented cross-site model: super admin access to another
    // site's admin panel is automatic, but effective role for content operations
    // there stays 'viewer' unless a real user_site_roles row exists.
    const event = createMockEvent({
      siteId: OTHER_SITE,
      session: { user: { id: superAdminUserId, name: 'Super', email: 'super@perms.test' } },
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
  it('resolves when the user holds super_admin on the current site', async () => {
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

  // Platform actions are only accepted on a domain where the caller actually holds
  // super_admin. A tenant admin can run script on their own site's pages (custom head
  // HTML), so accepting a super admin's session from ANY domain let that script drive
  // platform-wide endpoints from the tenant's domain.
  it('throws 403 on a site where the super admin holds no super_admin grant', async () => {
    const event = createMockEvent({
      siteId: OTHER_SITE,
      session: { user: { id: superAdminUserId, name: 'Super', email: 'super@perms.test' } },
    })
    await expect(
      requireSuperAdmin(event as unknown as H3Event),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 403 when no site was resolved for the request', async () => {
    const event = createMockEvent({
      siteId: null as unknown as string,
      session: { user: { id: superAdminUserId, name: 'Super', email: 'super@perms.test' } },
    })
    await expect(
      requireSuperAdmin(event as unknown as H3Event),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('canEditContentItem', () => {
  const me = 'user-me'
  it('lets editors and above edit anything', () => {
    for (const role of ['editor', 'admin', 'super_admin'] as const) {
      expect(canEditContentItem(role, me, { authorId: 'someone-else', status: 'published' })).toBe(true)
    }
  })

  it('lets an author edit only their own draft or in-review items', () => {
    expect(canEditContentItem('author', me, { authorId: me, status: 'draft' })).toBe(true)
    expect(canEditContentItem('author', me, { authorId: me, status: 'review' })).toBe(true)
    expect(canEditContentItem('author', me, { authorId: me, status: 'published' })).toBe(false)
    expect(canEditContentItem('author', me, { authorId: me, status: 'scheduled' })).toBe(false)
    expect(canEditContentItem('author', me, { authorId: me, status: 'archived' })).toBe(false)
    expect(canEditContentItem('author', me, { authorId: 'someone-else', status: 'draft' })).toBe(false)
    expect(canEditContentItem('author', me, { authorId: null, status: 'draft' })).toBe(false)
  })

  it('never lets member/viewer edit', () => {
    expect(canEditContentItem('member', me, { authorId: me, status: 'draft' })).toBe(false)
    expect(canEditContentItem('viewer', me, { authorId: me, status: 'draft' })).toBe(false)
  })
})
