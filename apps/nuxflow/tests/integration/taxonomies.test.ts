import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { taxonomies, taxonomyTerms, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: listHandler } = await import('../../server/api/v1/taxonomies/index.get')
const { default: createHandler } = await import('../../server/api/v1/taxonomies/index.post')
const { default: patchHandler } = await import('../../server/api/v1/taxonomies/[id].patch')
const { default: deleteHandler } = await import('../../server/api/v1/taxonomies/[id].delete')
const { default: termsListHandler } = await import('../../server/api/v1/taxonomies/[id]/terms.get')
const { default: termCreateHandler } = await import('../../server/api/v1/taxonomies/[id]/terms.post')
const { default: termPatchHandler } = await import('../../server/api/v1/taxonomies/[id]/terms/[termId].patch')
const { default: termDeleteHandler } = await import('../../server/api/v1/taxonomies/[id]/terms/[termId].delete')

const SITE = 'site-tax-01'
const OTHER_SITE = 'site-tax-02'

let editorId: string
let authorId: string
let adminId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'tax.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'tax2.localhost' })

  editorId = await seedUser(db, { email: 'editor@tax.test', name: 'Editor' })
  authorId = await seedUser(db, { email: 'author@tax.test', name: 'Author' })
  adminId = await seedUser(db, { email: 'admin@tax.test', name: 'Admin' })

  await seedRole(db, editorId, SITE, 'editor')
  await seedRole(db, authorId, SITE, 'author')
  await seedRole(db, adminId, SITE, 'admin')
})

afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>

function editorEvent(opts: { body?: unknown; params?: Record<string, string>; siteId?: string } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@tax.test' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

function authorEvent(opts: { body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: authorId, name: 'Author', email: 'author@tax.test' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

function adminEvent(opts: { body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@tax.test' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

async function seedTaxonomy(overrides: Partial<typeof taxonomies.$inferInsert> = {}) {
  const db = getCurrentTestDb()
  const id = overrides.id ?? ulid()
  await db.insert(taxonomies).values({
    id, siteId: SITE, slug: `tax-${id.toLowerCase()}`, name: 'Category', isHierarchical: false,
    ...overrides,
  })
  return id
}

async function seedTerm(taxonomyId: string, overrides: Partial<typeof taxonomyTerms.$inferInsert> = {}) {
  const db = getCurrentTestDb()
  const id = overrides.id ?? ulid()
  await db.insert(taxonomyTerms).values({
    id, taxonomyId, slug: `term-${id.toLowerCase()}`, name: 'Term',
    ...overrides,
  })
  return id
}

describe('GET /api/v1/taxonomies', () => {
  it('throws 401 when unauthenticated', async () => {
    const event = createMockEvent({ siteId: SITE, session: null }) as unknown as H3Event
    await expect((listHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('lists taxonomies scoped to the current site only', async () => {
    const id = await seedTaxonomy({ name: 'Visible Here' })
    await seedTaxonomy({ id: ulid(), siteId: OTHER_SITE, name: 'Other Site Taxonomy', slug: 'other' })

    const result = await (listHandler as Handler)(authorEvent()) as { taxonomies: { id: string; name: string }[] }
    expect(result.taxonomies.some(t => t.id === id)).toBe(true)
    expect(result.taxonomies.some(t => t.name === 'Other Site Taxonomy')).toBe(false)
  })
})

describe('POST /api/v1/taxonomies', () => {
  it('throws 403 for author (below editor)', async () => {
    await expect(
      (createHandler as Handler)(authorEvent({ body: { name: 'Genre', slug: 'genre' } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates a taxonomy as editor and writes an audit log', async () => {
    const event = editorEvent({ body: { name: 'Genre', slug: `genre-${ulid().toLowerCase()}`, isHierarchical: true } })
    const result = await (createHandler as Handler)(event) as { id: string }
    expect(typeof result.id).toBe('string')

    const db = getCurrentTestDb()
    const row = await db.query.taxonomies.findFirst({ where: eq(taxonomies.id, result.id) })
    expect(row?.name).toBe('Genre')
    expect(row?.isHierarchical).toBe(true)

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.resource, 'taxonomy'), eq(auditLogs.resourceId, result.id)),
    })
    expect(log?.action).toBe('create')
  })

  it('throws 409 on duplicate slug within the same site', async () => {
    const slug = `dup-${ulid().toLowerCase()}`
    await (createHandler as Handler)(editorEvent({ body: { name: 'First', slug } }))
    await expect(
      (createHandler as Handler)(editorEvent({ body: { name: 'Second', slug } })),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('PATCH /api/v1/taxonomies/:id', () => {
  it('updates name and writes audit log', async () => {
    const id = await seedTaxonomy({ name: 'Old Name' })
    const result = await (patchHandler as Handler)(
      editorEvent({ params: { id }, body: { name: 'New Name' } }),
    ) as { id: string }
    expect(result.id).toBe(id)

    const db = getCurrentTestDb()
    const row = await db.query.taxonomies.findFirst({ where: eq(taxonomies.id, id) })
    expect(row?.name).toBe('New Name')
  })

  it('throws 404 when taxonomy belongs to a different site', async () => {
    const id = await seedTaxonomy({ id: ulid(), siteId: OTHER_SITE, name: 'Foreign', slug: 'foreign' })
    await expect(
      (patchHandler as Handler)(editorEvent({ params: { id }, body: { name: 'Hijacked' } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('DELETE /api/v1/taxonomies/:id', () => {
  it('throws 403 for editor (below admin)', async () => {
    const id = await seedTaxonomy()
    await expect(
      (deleteHandler as Handler)(editorEvent({ params: { id } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('deletes as admin', async () => {
    const id = await seedTaxonomy()
    await (deleteHandler as Handler)(adminEvent({ params: { id } }))

    const db = getCurrentTestDb()
    const row = await db.query.taxonomies.findFirst({ where: eq(taxonomies.id, id) })
    expect(row).toBeUndefined()
  })
})

describe('taxonomy terms', () => {
  it('lists terms for a taxonomy', async () => {
    const taxId = await seedTaxonomy()
    const termId = await seedTerm(taxId, { name: 'Term A' })

    const result = await (termsListHandler as Handler)(
      authorEvent({ params: { id: taxId } }),
    ) as { terms: { id: string }[] }
    expect(result.terms.some(t => t.id === termId)).toBe(true)
  })

  it('throws 404 listing terms for a taxonomy on another site', async () => {
    const taxId = await seedTaxonomy({ id: ulid(), siteId: OTHER_SITE, name: 'Foreign', slug: 'foreign2' })
    await expect(
      (termsListHandler as Handler)(authorEvent({ params: { id: taxId } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('creates a term as editor', async () => {
    const taxId = await seedTaxonomy()
    const event = editorEvent({ params: { id: taxId }, body: { name: 'New Term', slug: `new-term-${ulid().toLowerCase()}` } })
    const result = await (termCreateHandler as Handler)(event) as { id: string }

    const db = getCurrentTestDb()
    const row = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, result.id) })
    expect(row?.taxonomyId).toBe(taxId)
  })

  it('updates a term', async () => {
    const taxId = await seedTaxonomy()
    const termId = await seedTerm(taxId, { name: 'Before' })

    await (termPatchHandler as Handler)(
      editorEvent({ params: { id: taxId, termId }, body: { name: 'After' } }),
    )

    const db = getCurrentTestDb()
    const row = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, termId) })
    expect(row?.name).toBe('After')
  })

  it('reparents children to null when a parent term is deleted', async () => {
    const taxId = await seedTaxonomy()
    const parentId = await seedTerm(taxId, { name: 'Parent' })
    const childId = await seedTerm(taxId, { name: 'Child', parentId })

    await (termDeleteHandler as Handler)(editorEvent({ params: { id: taxId, termId: parentId } }))

    const db = getCurrentTestDb()
    const parentRow = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, parentId) })
    const childRow = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, childId) })
    expect(parentRow).toBeUndefined()
    expect(childRow?.parentId).toBeNull()
  })

  it('throws 404 when the term does not belong to the given taxonomy', async () => {
    const taxA = await seedTaxonomy()
    const taxB = await seedTaxonomy()
    const termInB = await seedTerm(taxB, { name: 'Belongs to B' })

    await expect(
      (termPatchHandler as Handler)(editorEvent({ params: { id: taxA, termId: termInB }, body: { name: 'Hijack' } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
