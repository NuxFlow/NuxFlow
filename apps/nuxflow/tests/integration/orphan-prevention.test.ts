/**
 * Regression tests for a release-readiness audit finding: taxonomyTerms.parentId,
 * comments.parentId, and mediaFolders.parentId have no DB-level foreign key (see the
 * schema comments in packages/db/src/schema/{content,media}.ts for why — adding one via
 * drizzle-kit's required table-rebuild migration would trigger its own ON DELETE SET NULL
 * action against every row during that migration's DROP TABLE step, silently wiping out
 * every parent/reply/folder relationship in the table as a side effect of the migration
 * itself). Orphan prevention is enforced in application code instead, in each of these
 * three delete routes — these tests are what actually verifies that still works.
 *
 * Also covers the user_site_roles unique constraint (idx_user_site_roles_user_site) added
 * in migrations/0013_classy_sabretooth.sql, closing a TOCTOU race in the invite flow.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMediaFolder } from '../helpers/seed'
import { taxonomies, taxonomyTerms, comments, mediaFolders, userSiteRoles } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import termDeleteHandler from '../../server/api/v1/taxonomies/[id]/terms/[termId].delete'
import commentDeleteHandler from '../../server/api/v1/comments/[id].delete'
import folderDeleteHandler from '../../server/api/v1/media/folders/[id].delete'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-orphan-prevention-01'
let editorUserId: string
let contentTypeId: string
let contentItemId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(params: Record<string, string>) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorUserId, name: 'Editor', email: 'editor@orphan-prevention.test' } },
    params,
  }) as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'orphan-prevention.localhost' })
  editorUserId = await seedUser(db, { email: 'editor@orphan-prevention.test' })
  await seedRole(db, editorUserId, SITE, 'editor')

  contentTypeId = await seedContentType(db, SITE)
  contentItemId = await seedContentItem(db, SITE, contentTypeId)
})

afterAll(teardownTestDb)

describe('DELETE /api/v1/taxonomies/:id/terms/:termId — reparents child terms', () => {
  it('sets parentId to null on child terms instead of leaving a dangling reference', async () => {
    const db = getCurrentTestDb()
    const taxonomyId = ulid()
    await db.insert(taxonomies).values({ id: taxonomyId, siteId: SITE, slug: 'topics', name: 'Topics', isHierarchical: true })

    const parentTermId = ulid()
    const childTermId = ulid()
    await db.insert(taxonomyTerms).values({ id: parentTermId, taxonomyId, slug: 'parent', name: 'Parent' })
    await db.insert(taxonomyTerms).values({ id: childTermId, taxonomyId, slug: 'child', name: 'Child', parentId: parentTermId })

    await (termDeleteHandler as HandlerFn)(mkEvent({ id: taxonomyId, termId: parentTermId }))

    const parent = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, parentTermId) })
    expect(parent).toBeUndefined()

    const child = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, childTermId) })
    expect(child).toBeTruthy()
    expect(child?.parentId).toBeNull()
  })
})

describe('DELETE /api/v1/comments/:id — reparents replies', () => {
  it('sets parentId to null on replies instead of leaving a dangling reference', async () => {
    const db = getCurrentTestDb()
    const parentCommentId = ulid()
    const replyId = ulid()
    await db.insert(comments).values({
      id: parentCommentId, siteId: SITE, itemId: contentItemId, body: 'Parent comment', status: 'approved',
    })
    await db.insert(comments).values({
      id: replyId, siteId: SITE, itemId: contentItemId, body: 'A reply', status: 'approved', parentId: parentCommentId,
    })

    await (commentDeleteHandler as HandlerFn)(mkEvent({ id: parentCommentId }))

    const parent = await db.query.comments.findFirst({ where: eq(comments.id, parentCommentId) })
    expect(parent).toBeUndefined()

    const reply = await db.query.comments.findFirst({ where: eq(comments.id, replyId) })
    expect(reply).toBeTruthy()
    expect(reply?.parentId).toBeNull()
  })
})

describe('DELETE /api/v1/media/folders/:id — reparents subfolders (and unfiles media)', () => {
  it('sets parentId to null on subfolders instead of leaving a dangling reference', async () => {
    const db = getCurrentTestDb()
    const parentFolderId = await seedMediaFolder(db, SITE, { name: 'Parent Folder' })
    const subfolderId = await seedMediaFolder(db, SITE, { name: 'Subfolder', parentId: parentFolderId })

    await (folderDeleteHandler as HandlerFn)(mkEvent({ id: parentFolderId }))

    const parent = await db.query.mediaFolders.findFirst({ where: eq(mediaFolders.id, parentFolderId) })
    expect(parent).toBeUndefined()

    const subfolder = await db.query.mediaFolders.findFirst({ where: eq(mediaFolders.id, subfolderId) })
    expect(subfolder).toBeTruthy()
    expect(subfolder?.parentId).toBeNull()
  })
})

describe('user_site_roles unique constraint (idx_user_site_roles_user_site)', () => {
  it('rejects a second role row for the same (user_id, site_id) pair', async () => {
    const db = getCurrentTestDb()
    const targetUserId = await seedUser(db, { email: 'dup-role@orphan-prevention.test' })
    await db.insert(userSiteRoles).values({ id: ulid(), userId: targetUserId, siteId: SITE, role: 'viewer' })

    await expect(
      db.insert(userSiteRoles).values({ id: ulid(), userId: targetUserId, siteId: SITE, role: 'editor' }),
    ).rejects.toThrow()
  })

  it('onConflictDoNothing() lets the losing side of the invite-flow race no-op instead of throwing', async () => {
    const db = getCurrentTestDb()
    const targetUserId = await seedUser(db, { email: 'race-role@orphan-prevention.test' })
    await db.insert(userSiteRoles).values({ id: ulid(), userId: targetUserId, siteId: SITE, role: 'author' })

    // Mirrors server/api/v1/users/index.post.ts's roleInsert — the second concurrent
    // invite for the same (user, site) pair silently no-ops instead of crashing.
    await expect(
      db.insert(userSiteRoles).values({ id: ulid(), userId: targetUserId, siteId: SITE, role: 'editor' }).onConflictDoNothing(),
    ).resolves.not.toThrow()

    // The original role wins — the race's loser doesn't clobber it.
    const role = await db.query.userSiteRoles.findFirst({ where: eq(userSiteRoles.userId, targetUserId) })
    expect(role?.role).toBe('author')
  })
})
