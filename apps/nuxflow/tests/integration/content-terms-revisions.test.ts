/**
 * Integration tests for content term assignment and revision history:
 *   GET/PUT /api/v1/content/:id/terms
 *   GET     /api/v1/content/:id/revisions
 *   POST    /api/v1/content/:id/revisions/:revisionId/restore
 *
 * Behaviour under test:
 *  - PUT terms shares the author ownership/status rule (assertCanEditContentItem) with
 *    PATCH /content/:id — an author can't retag someone else's or a published item.
 *  - PUT terms rejects term ids belonging to another site's taxonomy.
 *  - PUT terms replaces the whole assignment set (including clearing it).
 *  - Revision restore is editor+, scoped to the item, and 404s cross-item/cross-site.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { taxonomies, taxonomyTerms, contentTaxonomyTerms, contentRevisions, contentItems, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { mockPurge } = vi.hoisted(() => ({ mockPurge: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/edge-cache', () => ({ purgeContentCache: mockPurge }))

const { default: getTermsHandler } = await import('../../server/api/v1/content/[id]/terms.get')
const { default: putTermsHandler } = await import('../../server/api/v1/content/[id]/terms.put')
const { default: revisionsHandler } = await import('../../server/api/v1/content/[id]/revisions.get')
const { default: restoreHandler } = await import('../../server/api/v1/content/[id]/revisions/[revisionId]/restore.post')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-terms-rev-01'
const OTHER = 'site-terms-rev-02'

let editorId: string
let authorId: string
let otherAuthorId: string
let typeId: string
let termA: string
let termB: string
let foreignTerm: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'terms.localhost' })
  await seedSite(db, { id: OTHER, domain: 'terms2.localhost' })

  editorId = await seedUser(db, { email: 'editor@terms.test' })
  authorId = await seedUser(db, { email: 'author@terms.test' })
  otherAuthorId = await seedUser(db, { email: 'author2@terms.test' })
  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  await seedRole(db, otherAuthorId, SITE, 'author')

  typeId = await seedContentType(db, SITE, { slug: 'post', name: 'Post' })

  const taxId = ulid()
  const foreignTaxId = ulid()
  await db.insert(taxonomies).values([
    { id: taxId, siteId: SITE, slug: 'tags', name: 'Tags' },
    { id: foreignTaxId, siteId: OTHER, slug: 'tags', name: 'Tags' },
  ])
  termA = ulid(); termB = ulid(); foreignTerm = ulid()
  await db.insert(taxonomyTerms).values([
    { id: termA, taxonomyId: taxId, slug: 'alpha', name: 'Alpha' },
    { id: termB, taxonomyId: taxId, slug: 'beta', name: 'Beta' },
    { id: foreignTerm, taxonomyId: foreignTaxId, slug: 'gamma', name: 'Gamma' },
  ])
})

afterAll(teardownTestDb)

function ev(userId: string, opts: { siteId?: string; body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: { user: { id: userId, name: 'U', email: 'u@example.com' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

async function assigned(itemId: string) {
  const db = getCurrentTestDb()
  const rows = await db.select().from(contentTaxonomyTerms).where(eq(contentTaxonomyTerms.contentItemId, itemId))
  return rows.map(r => r.termId).sort()
}

describe('PUT /api/v1/content/:id/terms', () => {
  it('replaces the full assignment set, writes an audit log, and purges affected caches', async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, typeId, { authorId: editorId })

    await (putTermsHandler as Handler)(ev(editorId, { params: { id: itemId }, body: { termIds: [termA] } }))
    expect(await assigned(itemId)).toEqual([termA])

    mockPurge.mockClear()
    await (putTermsHandler as Handler)(ev(editorId, { params: { id: itemId }, body: { termIds: [termB] } }))
    expect(await assigned(itemId)).toEqual([termB])
    expect(mockPurge).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      taxonomyTerms: [{ taxonomySlug: 'tags', termSlug: 'beta' }],
    }))

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.action, 'update_terms'), eq(auditLogs.resourceId, itemId)),
    })
    expect(log).toBeDefined()
  })

  it('clears every assignment when given an empty list', async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, typeId, { authorId: editorId })
    await (putTermsHandler as Handler)(ev(editorId, { params: { id: itemId }, body: { termIds: [termA, termB] } }))
    await (putTermsHandler as Handler)(ev(editorId, { params: { id: itemId }, body: { termIds: [] } }))
    expect(await assigned(itemId)).toEqual([])
  })

  it('rejects a term that belongs to another site\'s taxonomy and leaves assignments untouched', async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, typeId, { authorId: editorId })
    await (putTermsHandler as Handler)(ev(editorId, { params: { id: itemId }, body: { termIds: [termA] } }))

    await expect((putTermsHandler as Handler)(ev(editorId, { params: { id: itemId }, body: { termIds: [termA, foreignTerm] } })))
      .rejects.toMatchObject({ statusCode: 422 })
    expect(await assigned(itemId)).toEqual([termA])
  })

  it('lets an author retag their own draft', async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, typeId, { authorId, status: 'draft' })
    await (putTermsHandler as Handler)(ev(authorId, { params: { id: itemId }, body: { termIds: [termA] } }))
    expect(await assigned(itemId)).toEqual([termA])
  })

  it('forbids an author retagging another author\'s draft', async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, typeId, { authorId: otherAuthorId, status: 'draft' })
    await expect((putTermsHandler as Handler)(ev(authorId, { params: { id: itemId }, body: { termIds: [termA] } })))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(await assigned(itemId)).toEqual([])
  })

  it('forbids an author retagging their own item once published', async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, typeId, { authorId, status: 'published' })
    await expect((putTermsHandler as Handler)(ev(authorId, { params: { id: itemId }, body: { termIds: [termA] } })))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('404s for an item on another site', async () => {
    const db = getCurrentTestDb()
    const foreignType = await seedContentType(db, OTHER, { slug: 'post' })
    const foreignItem = await seedContentItem(db, OTHER, foreignType)
    await expect((putTermsHandler as Handler)(ev(editorId, { params: { id: foreignItem }, body: { termIds: [] } })))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('GET /api/v1/content/:id/terms', () => {
  it('returns the assigned terms', async () => {
    const db = getCurrentTestDb()
    const itemId = await seedContentItem(db, SITE, typeId, { authorId: editorId })
    await (putTermsHandler as Handler)(ev(editorId, { params: { id: itemId }, body: { termIds: [termA, termB] } }))
    const res = await (getTermsHandler as Handler)(ev(authorId, { params: { id: itemId } })) as { terms: { id?: string; termId?: string }[] }
    expect(res.terms).toHaveLength(2)
  })

  it('rejects a user with no role on this site', async () => {
    const db = getCurrentTestDb()
    const stranger = await seedUser(db, { email: 'stranger@terms.test' })
    const itemId = await seedContentItem(db, SITE, typeId)
    await expect((getTermsHandler as Handler)(ev(stranger, { params: { id: itemId } })))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('revisions', () => {
  let itemId: string
  let oldRev: string

  beforeAll(async () => {
    const db = getCurrentTestDb()
    itemId = await seedContentItem(db, SITE, typeId, { title: 'Current title', content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    oldRev = ulid()
    await db.insert(contentRevisions).values([
      { id: oldRev, itemId, title: 'Old title', content: { type: 'doc', content: [] }, createdAt: '2026-01-01 00:00:00' },
      { id: ulid(), itemId, title: 'Newer title', content: { type: 'doc', content: [] }, createdAt: '2026-02-01 00:00:00' },
    ])
  })

  it('lists revisions newest-first without the heavy content column', async () => {
    const res = await (revisionsHandler as Handler)(ev(authorId, { params: { id: itemId } })) as { revisions: Record<string, unknown>[] }
    expect(res.revisions.map(r => r.title)).toEqual(['Newer title', 'Old title'])
    expect(res.revisions[0]).not.toHaveProperty('content')
  })

  it('caps the list at 50 entries', async () => {
    const db = getCurrentTestDb()
    const busy = await seedContentItem(db, SITE, typeId)
    await db.insert(contentRevisions).values(Array.from({ length: 60 }, (_, i) => ({ id: ulid(), itemId: busy, title: `r${i}` })))
    const res = await (revisionsHandler as Handler)(ev(editorId, { params: { id: busy } })) as { revisions: unknown[] }
    expect(res.revisions).toHaveLength(50)
  })

  it('forbids an author from restoring a revision', async () => {
    await expect((restoreHandler as Handler)(ev(authorId, { params: { id: itemId, revisionId: oldRev } })))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('restores title and content from the revision', async () => {
    await (restoreHandler as Handler)(ev(editorId, { params: { id: itemId, revisionId: oldRev } }))
    const db = getCurrentTestDb()
    const row = await db.query.contentItems.findFirst({ where: eq(contentItems.id, itemId) })
    expect(row?.title).toBe('Old title')
    expect(row?.content).toEqual({ type: 'doc', content: [] })
  })

  it('404s when the revision belongs to a different item', async () => {
    const db = getCurrentTestDb()
    const other = await seedContentItem(db, SITE, typeId)
    await expect((restoreHandler as Handler)(ev(editorId, { params: { id: other, revisionId: oldRev } })))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
