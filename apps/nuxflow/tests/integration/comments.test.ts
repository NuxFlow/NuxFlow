import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { comments, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: listHandler } = await import('../../server/api/v1/comments/index.get')
const { default: patchHandler } = await import('../../server/api/v1/comments/[id].patch')
const { default: deleteHandler } = await import('../../server/api/v1/comments/[id].delete')
const { default: publicListHandler } = await import('../../server/api/v1/content/[id]/comments.get')

const SITE = 'site-comments-01'
const OTHER_SITE = 'site-comments-02'

let editorId: string
let authorId: string
let itemId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'comments.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'comments2.localhost' })

  editorId = await seedUser(db, { email: 'editor@comments.test', name: 'Editor' })
  authorId = await seedUser(db, { email: 'author@comments.test', name: 'Author' })

  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')

  const typeId = await seedContentType(db, SITE)
  itemId = await seedContentItem(db, SITE, typeId)
})

afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>

function editorEvent(opts: { query?: Record<string, string>; body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@comments.test' } },
    query: opts.query,
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

function authorEvent(opts: { body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: authorId, name: 'Author', email: 'author@comments.test' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

async function seedComment(overrides: Partial<typeof comments.$inferInsert> = {}) {
  const db = getCurrentTestDb()
  const id = overrides.id ?? ulid()
  await db.insert(comments).values({
    id, siteId: SITE, itemId, body: 'Hello world', status: 'pending',
    guestName: 'Guest', guestEmail: 'guest@example.com',
    ...overrides,
  })
  return id
}

describe('GET /api/v1/comments', () => {
  it('throws 403 for author (below editor)', async () => {
    await expect((listHandler as Handler)(authorEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('defaults to pending status and is scoped to the current site', async () => {
    const pendingId = await seedComment({ status: 'pending' })
    const approvedId = await seedComment({ status: 'approved' })
    await seedComment({ id: ulid(), siteId: OTHER_SITE, itemId, status: 'pending' })

    const result = await (listHandler as Handler)(editorEvent()) as { comments: { id: string }[] }
    expect(result.comments.some(c => c.id === pendingId)).toBe(true)
    expect(result.comments.some(c => c.id === approvedId)).toBe(false)
  })

  it('returns all statuses when status=all', async () => {
    const approvedId = await seedComment({ status: 'approved' })
    const result = await (listHandler as Handler)(editorEvent({ query: { status: 'all' } })) as { comments: { id: string }[] }
    expect(result.comments.some(c => c.id === approvedId)).toBe(true)
  })
})

describe('PATCH /api/v1/comments/:id', () => {
  it('updates status and writes an audit log', async () => {
    const id = await seedComment({ status: 'pending' })
    const result = await (patchHandler as Handler)(
      editorEvent({ params: { id }, body: { status: 'approved' } }),
    ) as { id: string; status: string }
    expect(result.status).toBe('approved')

    const db = getCurrentTestDb()
    const row = await db.query.comments.findFirst({ where: eq(comments.id, id) })
    expect(row?.status).toBe('approved')

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.resource, 'comment'), eq(auditLogs.resourceId, id)),
    })
    expect(log?.action).toBe('update')
  })

  it('throws 404 for a comment on another site', async () => {
    const id = await seedComment({ id: ulid(), siteId: OTHER_SITE })
    await expect(
      (patchHandler as Handler)(editorEvent({ params: { id }, body: { status: 'spam' } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('DELETE /api/v1/comments/:id', () => {
  it('reparents replies to null when a parent comment is deleted', async () => {
    const parentId = await seedComment({ body: 'Parent comment' })
    const childId = await seedComment({ body: 'Reply', parentId })

    await (deleteHandler as Handler)(editorEvent({ params: { id: parentId } }))

    const db = getCurrentTestDb()
    const parentRow = await db.query.comments.findFirst({ where: eq(comments.id, parentId) })
    const childRow = await db.query.comments.findFirst({ where: eq(comments.id, childId) })
    expect(parentRow).toBeUndefined()
    expect(childRow?.parentId).toBeNull()
  })
})

describe('GET /api/v1/content/:id/comments (public)', () => {
  it('only returns approved comments for an unauthenticated visitor', async () => {
    const approvedId = await seedComment({ status: 'approved', body: 'Public approved' })
    const pendingId = await seedComment({ status: 'pending', body: 'Hidden pending' })

    const event = createMockEvent({ siteId: SITE, session: null, params: { id: itemId } }) as unknown as H3Event
    const result = await (publicListHandler as Handler)(event) as { comments: { id: string }[] }

    expect(result.comments.some(c => c.id === approvedId)).toBe(true)
    expect(result.comments.some(c => c.id === pendingId)).toBe(false)
  })

  it('strips guestEmail from the public response', async () => {
    await seedComment({ status: 'approved', body: 'Has email', guestEmail: 'secret@example.com' })
    const event = createMockEvent({ siteId: SITE, session: null, params: { id: itemId } }) as unknown as H3Event
    const result = await (publicListHandler as Handler)(event) as { comments: Record<string, unknown>[] }

    for (const c of result.comments) {
      expect(c).not.toHaveProperty('guestEmail')
    }
  })

  it('returns pending comments too when the caller is a real site member', async () => {
    const pendingId = await seedComment({ status: 'pending', body: 'Visible to editor' })
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: editorId, name: 'Editor', email: 'editor@comments.test' } },
      params: { id: itemId },
    }) as unknown as H3Event

    const result = await (publicListHandler as Handler)(event) as { comments: { id: string }[] }
    expect(result.comments.some(c => c.id === pendingId)).toBe(true)
  })

  it('does not leak another site\'s pending comments to a session-holder with no role there', async () => {
    const otherTypeId = await seedContentType(getCurrentTestDb(), OTHER_SITE)
    const otherItemId = await seedContentItem(getCurrentTestDb(), OTHER_SITE, otherTypeId)
    const foreignPendingId = await seedComment({ id: ulid(), siteId: OTHER_SITE, itemId: otherItemId, status: 'pending' })

    // editorId has no role on OTHER_SITE
    const event = createMockEvent({
      siteId: OTHER_SITE,
      session: { user: { id: editorId, name: 'Editor', email: 'editor@comments.test' } },
      params: { id: otherItemId },
    }) as unknown as H3Event

    const result = await (publicListHandler as Handler)(event) as { comments: { id: string }[] }
    expect(result.comments.some(c => c.id === foreignPendingId)).toBe(false)
  })
})
