import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedTier, seedSubscription, seedContentType, seedContentItem, seedMedia, seedSetting } from '../helpers/seed'
import { users, contentItems, media, subscriptions, userSiteRoles, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import handler from '../../server/api/v1/account/index.delete'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { mockSignOut, mockStripeCancel } = vi.hoisted(() => ({
  mockSignOut: vi.fn().mockResolvedValue({ headers: { getSetCookie: () => [] } }),
  mockStripeCancel: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({ api: { signOut: mockSignOut } }),
}))

vi.mock('../../server/utils/payments/stripe', () => ({
  StripeProvider: vi.fn().mockImplementation(function () {
    return { cancelSubscription: mockStripeCancel }
  }),
}))

const SITE_A = 'site-acct-del-a'
const SITE_B = 'site-acct-del-b'

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(uid: string | null, siteId = SITE_A) {
  return createMockEvent({
    siteId,
    session: uid ? { user: { id: uid, name: 'User', email: `${uid}@acct-del.test` } } : null,
  }) as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE_A, domain: 'acct-del-a.localhost' })
  await seedSite(db, { id: SITE_B, domain: 'acct-del-b.localhost' })
  await seedSetting(db, SITE_A, 'payments.stripe_secret_key', 'sk_test_acct_del')
})

afterAll(teardownTestDb)

describe('DELETE /api/v1/account', () => {
  it('throws 401 when not authenticated', async () => {
    await expect((handler as HandlerFn)(mkEvent(null))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 403 for a super admin, without deleting the account', async () => {
    const db = getCurrentTestDb()
    const userId = await seedUser(db, { email: 'super@acct-del.test' })
    await seedRole(db, userId, SITE_A, 'super_admin')

    await expect((handler as HandlerFn)(mkEvent(userId))).rejects.toMatchObject({ statusCode: 403 })

    expect(await db.query.users.findFirst({ where: eq(users.id, userId) })).toBeDefined()
  })

  it('blocks deletion when an active subscription exists on a different site', async () => {
    const db = getCurrentTestDb()
    const userId = await seedUser(db, { email: 'other-site-sub@acct-del.test' })
    await seedRole(db, userId, SITE_A, 'member')
    const tierId = await seedTier(db, SITE_B)
    await seedSubscription(db, SITE_B, userId, tierId, { status: 'active' })

    await expect((handler as HandlerFn)(mkEvent(userId, SITE_A))).rejects.toMatchObject({
      statusCode: 409,
      data: { domains: ['acct-del-b.localhost'] },
    })

    expect(await db.query.users.findFirst({ where: eq(users.id, userId) })).toBeDefined()
  })

  it('cancels an active subscription on the current site, then deletes the account', async () => {
    const db = getCurrentTestDb()
    const userId = await seedUser(db, { email: 'current-site-sub@acct-del.test' })
    await seedRole(db, userId, SITE_A, 'member')
    const tierId = await seedTier(db, SITE_A)
    await seedSubscription(db, SITE_A, userId, tierId, {
      status: 'active', provider: 'stripe', providerSubscriptionId: 'sub_acct_del_001',
    })

    mockStripeCancel.mockClear()
    const result = await (handler as HandlerFn)(mkEvent(userId, SITE_A))
    expect(result).toBeNull()
    expect(mockStripeCancel).toHaveBeenCalledWith('sub_acct_del_001')

    expect(await db.query.users.findFirst({ where: eq(users.id, userId) })).toBeUndefined()
  })

  it('skips the provider call for a free-tier subscription but still deletes the account', async () => {
    const db = getCurrentTestDb()
    const userId = await seedUser(db, { email: 'free-sub@acct-del.test' })
    await seedRole(db, userId, SITE_A, 'member')
    const tierId = await seedTier(db, SITE_A)
    await seedSubscription(db, SITE_A, userId, tierId, {
      status: 'active', provider: 'stripe', providerSubscriptionId: 'free_abc123',
    })

    mockStripeCancel.mockClear()
    await (handler as HandlerFn)(mkEvent(userId, SITE_A))
    expect(mockStripeCancel).not.toHaveBeenCalled()
    expect(await db.query.users.findFirst({ where: eq(users.id, userId) })).toBeUndefined()
  })

  it('calls Better Auth sign-out as a best-effort side effect', async () => {
    const db = getCurrentTestDb()
    const userId = await seedUser(db, { email: 'signout@acct-del.test' })
    await seedRole(db, userId, SITE_A, 'member')

    mockSignOut.mockClear()
    await (handler as HandlerFn)(mkEvent(userId, SITE_A))
    expect(mockSignOut).toHaveBeenCalledOnce()
  })

  it('does not fail the deletion when sign-out itself throws', async () => {
    const db = getCurrentTestDb()
    const userId = await seedUser(db, { email: 'signout-fails@acct-del.test' })
    await seedRole(db, userId, SITE_A, 'member')

    mockSignOut.mockRejectedValueOnce(new Error('boom'))
    await expect((handler as HandlerFn)(mkEvent(userId, SITE_A))).resolves.toBeNull()
    expect(await db.query.users.findFirst({ where: eq(users.id, userId) })).toBeUndefined()
  })

  it('cascades to remove site-role rows and anonymizes (not deletes) authored content and media', async () => {
    const db = getCurrentTestDb()
    const userId = await seedUser(db, { email: 'author@acct-del.test' })
    await seedRole(db, userId, SITE_A, 'editor')

    const typeId = await seedContentType(db, SITE_A)
    const itemId = await seedContentItem(db, SITE_A, typeId, { authorId: userId })
    const mediaId = await seedMedia(db, SITE_A, { uploadedBy: userId })

    await (handler as HandlerFn)(mkEvent(userId, SITE_A))

    expect(await db.query.users.findFirst({ where: eq(users.id, userId) })).toBeUndefined()
    expect(await db.query.userSiteRoles.findFirst({ where: and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.siteId, SITE_A)) })).toBeUndefined()

    // Content and media the person created belong to the site, not solely to them —
    // they survive with their author/uploader reference nulled out (real D1 FK
    // "on delete set null"), not cascade-deleted.
    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, itemId) })
    expect(item).toBeDefined()
    expect(item!.authorId).toBeNull()

    const mediaRow = await db.query.media.findFirst({ where: eq(media.id, mediaId) })
    expect(mediaRow).toBeDefined()
    expect(mediaRow!.uploadedBy).toBeNull()
  })

  it('writes an audit log entry for the deletion', async () => {
    const db = getCurrentTestDb()
    const userId = await seedUser(db, { email: 'audited@acct-del.test' })
    await seedRole(db, userId, SITE_A, 'member')

    await (handler as HandlerFn)(mkEvent(userId, SITE_A))

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.siteId, SITE_A), eq(auditLogs.resource, 'user'), eq(auditLogs.resourceId, userId)),
      orderBy: (l, { desc }) => [desc(l.createdAt)],
    })
    expect(log).toBeDefined()
    expect(log!.action).toBe('delete')

    // Confirms the cross-check in seedSubscription's sibling test doesn't leak
    // between tests (no leftover subscription rows for this iteration's user).
    expect(await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) })).toBeUndefined()
  })
})
