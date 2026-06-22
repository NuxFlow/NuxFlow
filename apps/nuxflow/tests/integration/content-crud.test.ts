/**
 * Integration tests for content CRUD operations:
 *   POST /api/v1/content            — create
 *   PATCH /api/v1/content/[id]      — update, including optimistic locking
 *   DELETE /api/v1/content/[id]     — delete
 *
 * The author role can create and update; editor is required to delete.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { contentItems, contentRevisions } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import createHandler from '../../server/api/v1/content/index.post'
import patchHandler from '../../server/api/v1/content/[id].patch'
import deleteHandler from '../../server/api/v1/content/[id].delete'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// broadcastPushToSite is fire-and-forget in the PATCH handler; silence it
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
}))

const SITE = 'site-crud-01'
let authorId: string
let editorId: string
let typeId: string
let existingItemId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'crud.localhost' })
  authorId = await seedUser(db, { email: 'author@crud.test' })
  editorId = await seedUser(db, { email: 'editor@crud.test' })
  await seedRole(db, authorId, SITE, 'author')
  await seedRole(db, editorId, SITE, 'editor')
  typeId = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })
  existingItemId = await seedContentItem(db, SITE, typeId, {
    slug: 'existing-post',
    title: 'Existing Post',
    status: 'draft',
    visibility: 'public',
    publishedAt: null,
  })
})

afterAll(teardownTestDb)

function asAuthor() {
  return { user: { id: authorId, name: 'Author', email: 'author@crud.test' } }
}
function asEditor() {
  return { user: { id: editorId, name: 'Editor', email: 'editor@crud.test' } }
}

function mkCreateEvent(body: unknown) {
  return createMockEvent({ siteId: SITE, session: asAuthor(), body }) as unknown as H3Event
}

function mkPatchEvent(body: unknown, id = existingItemId, role: 'author' | 'editor' = 'author') {
  return createMockEvent({
    siteId: SITE,
    session: role === 'editor' ? asEditor() : asAuthor(),
    body,
    params: { id },
  }) as unknown as H3Event
}

function mkDeleteEvent(id = existingItemId, role: 'author' | 'editor' = 'editor') {
  return createMockEvent({
    siteId: SITE,
    session: role === 'editor' ? asEditor() : asAuthor(),
    params: { id },
  }) as unknown as H3Event
}

// ---------------------------------------------------------------------------
// POST /api/v1/content
// ---------------------------------------------------------------------------

describe('POST /api/v1/content', () => {
  it('creates an item and returns its id', async () => {
    const event = mkCreateEvent({ title: 'New Post', slug: 'new-post', typeSlug: 'post' })
    const result = await (createHandler as HandlerFn)(event) as { id: string }
    expect(typeof result.id).toBe('string')
    expect(result.id.length).toBeGreaterThan(0)
  })

  it('sets status 201 on the response', async () => {
    const event = mkCreateEvent({ title: 'Status Post', slug: 'status-post', typeSlug: 'post' })
    await (createHandler as HandlerFn)(event)
    expect((event as unknown as { _status: number })._status).toBe(201)
  })

  it('persists the item in the database', async () => {
    const event = mkCreateEvent({ title: 'Persisted Post', slug: 'persisted-post', typeSlug: 'post' })
    const { id } = await (createHandler as HandlerFn)(event) as { id: string }

    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: eq(contentItems.id, id),
    })
    expect(item!.title).toBe('Persisted Post')
    expect(item!.slug).toBe('persisted-post')
    expect(item!.status).toBe('draft')
    expect(item!.authorId).toBe(authorId)
    expect(item!.siteId).toBe(SITE)
  })

  it('accepts an explicit status', async () => {
    const event = mkCreateEvent({ title: 'Published Post', slug: 'pub-post', typeSlug: 'post', status: 'published' })
    const { id } = await (createHandler as HandlerFn)(event) as { id: string }
    const item = await getCurrentTestDb().query.contentItems.findFirst({ where: eq(contentItems.id, id) })
    expect(item!.status).toBe('published')
  })

  it('returns 404 when the typeSlug does not exist', async () => {
    await expect(
      (createHandler as HandlerFn)(mkCreateEvent({ title: 'X', slug: 'x', typeSlug: 'nonexistent-type' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns a validation error when title is missing', async () => {
    await expect(
      (createHandler as HandlerFn)(mkCreateEvent({ slug: 'no-title', typeSlug: 'post' })),
    ).rejects.toThrow()
  })

  it('returns 403 when the user has no role on this site', async () => {
    const guestId = await seedUser(getCurrentTestDb(), { email: 'guest@crud.test' })
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: guestId, name: 'Guest', email: 'guest@crud.test' } },
      body: { title: 'Guest Post', slug: 'guest-post', typeSlug: 'post' },
    }) as unknown as H3Event
    await expect((createHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/content/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/content/[id] — basic updates', () => {
  it('updates the title and bumps the version number', async () => {
    const result = await (patchHandler as HandlerFn)(
      mkPatchEvent({ title: 'Updated Title' }),
    ) as { id: string; version: number }

    expect(result.version).toBe(2)
    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: eq(contentItems.id, existingItemId),
    })
    expect(item!.title).toBe('Updated Title')
    expect(item!.version).toBe(2)
  })

  it('returns 404 for an unknown id', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkPatchEvent({ title: 'x' }, 'nonexistent-000000')),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('sets publishedAt when status transitions to published for the first time', async () => {
    const freshId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'first-publish-test',
      title: 'First Publish',
      status: 'draft',
      publishedAt: null,
    })

    await (patchHandler as HandlerFn)(mkPatchEvent({ status: 'published' }, freshId))

    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: eq(contentItems.id, freshId),
    })
    expect(item!.status).toBe('published')
    expect(item!.publishedAt).toBeTruthy()
  })

  it('snapshots a revision record before each update', async () => {
    const snapshotId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'revision-target',
      title: 'Before Revision',
    })

    const countBefore = (
      await getCurrentTestDb().query.contentRevisions.findMany({
        where: eq(contentRevisions.itemId, snapshotId),
      })
    ).length

    await (patchHandler as HandlerFn)(mkPatchEvent({ title: 'After Revision' }, snapshotId))

    const countAfter = (
      await getCurrentTestDb().query.contentRevisions.findMany({
        where: eq(contentRevisions.itemId, snapshotId),
      })
    ).length

    expect(countAfter).toBe(countBefore + 1)
  })
})

describe('PATCH /api/v1/content/[id] — optimistic locking', () => {
  let lockItemId: string

  beforeAll(async () => {
    lockItemId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'lock-test-item',
      title: 'Lock Test',
      status: 'draft',
      publishedAt: null,
    })
  })

  it('returns 409 when expectedVersion does not match the stored version', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkPatchEvent({ title: 'Conflict', expectedVersion: 999 }, lockItemId)),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('includes the real currentVersion in the 409 error data', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkPatchEvent({ title: 'Conflict', expectedVersion: 999 }, lockItemId)),
    ).rejects.toMatchObject({ statusCode: 409, data: { currentVersion: 1 } })
  })

  it('succeeds and increments version when expectedVersion is correct', async () => {
    const result = await (patchHandler as HandlerFn)(
      mkPatchEvent({ title: 'No Conflict', expectedVersion: 1 }, lockItemId),
    ) as { version: number }
    expect(result.version).toBe(2)
  })

  it('subsequent update with stale expectedVersion returns 409 (version is now 2)', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkPatchEvent({ title: 'Stale Again', expectedVersion: 1 }, lockItemId)),
    ).rejects.toMatchObject({ statusCode: 409, data: { currentVersion: 2 } })
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/content/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/content/[id]', () => {
  let deleteTargetId: string

  beforeAll(async () => {
    deleteTargetId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'to-delete-item',
      title: 'To Delete',
    })
  })

  it('removes the item and returns { success: true }', async () => {
    const result = await (deleteHandler as HandlerFn)(mkDeleteEvent(deleteTargetId)) as { success: boolean }
    expect(result.success).toBe(true)

    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: eq(contentItems.id, deleteTargetId),
    })
    expect(item).toBeUndefined()
  })

  it('returns 404 when the item does not exist', async () => {
    await expect(
      (deleteHandler as HandlerFn)(mkDeleteEvent('nonexistent-delete-id')),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 403 when the user only has author role (editor required)', async () => {
    const authorOnlyId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'author-cannot-delete',
      title: 'Author Cannot Delete',
    })
    await expect(
      (deleteHandler as HandlerFn)(mkDeleteEvent(authorOnlyId, 'author')),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 when the item belongs to a different site (cross-site isolation)', async () => {
    const otherSite = 'site-crud-other-01'
    const db = getCurrentTestDb()
    await seedSite(db, { id: otherSite, domain: 'other-crud.localhost' })
    const otherTypeId = await seedContentType(db, otherSite, { slug: 'post', name: 'Posts', singularName: 'Post' })
    const otherId = await seedContentItem(db, otherSite, otherTypeId, {
      slug: 'cross-site-item',
      title: 'Cross Site Item',
    })

    // editorId has a role on SITE, not otherSite — the handler scopes the query
    // by event.context.siteId (which is SITE), so it won't find the item from otherSite
    const event = createMockEvent({
      siteId: SITE,
      session: asEditor(),
      params: { id: otherId },
    }) as unknown as H3Event

    await expect((deleteHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 404 })
  })
})
