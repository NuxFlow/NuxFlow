/**
 * Custom fields on content types: managing types and their fields (Admin → Content types),
 * saving values with an item (checked, required only to publish), the public page's
 * details, and the per-site backup carrying both.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/analytics', () => ({ trackPageView: vi.fn() }))
vi.mock('../../server/utils/edge-cache', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  purgeAllPublicPages: vi.fn().mockResolvedValue(undefined),
  purgeContentCache: vi.fn().mockResolvedValue(undefined),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))
vi.mock('../../server/utils/embeddings', () => ({
  upsertContentEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteContentEmbedding: vi.fn().mockResolvedValue(undefined),
}))

const { default: typesGet } = await import('../../server/api/v1/content-types/index.get')
const { default: typesPost } = await import('../../server/api/v1/content-types/index.post')
const { default: contentPost } = await import('../../server/api/v1/content/index.post')
const { default: contentPatch } = await import('../../server/api/v1/content/[id].patch')
const { default: publicPage } = await import('../../server/api/public/pages/[...slug].get')
const { buildBackup } = await import('../../server/utils/backup')

const SITE = 'site-custom-fields-01'
let adminId: string
let editorId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'custom-fields.localhost' })
  adminId = await seedUser(db, { email: 'admin@custom-fields.test' })
  editorId = await seedUser(db, { email: 'editor@custom-fields.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
  await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
})
afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>
const as = (userId: string, body?: unknown, params?: Record<string, string>) => createMockEvent({
  siteId: SITE, session: { user: { id: userId, name: 'U', email: 'u@custom-fields.test' } }, body, params,
}) as unknown as H3Event

const FIELDS = [
  { key: 'price', label: 'Price', type: 'number', prefix: '£', required: true },
  { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
  { key: 'amenities', label: 'Amenities', type: 'multiselect', options: ['Parking', 'Garden'] },
  { key: 'internal_ref', label: 'Reference', type: 'text', showOnPage: false },
]

async function createPropertyType(): Promise<string> {
  const res = await (typesPost as Handler)(as(adminId, { action: 'create', name: 'Properties', singularName: 'Property', slug: `property-${Math.random().toString(36).slice(2, 7)}` })) as { id: string }
  await (typesPost as Handler)(as(adminId, { action: 'update', id: res.id, fields: FIELDS }))
  return res.id
}

describe('Admin → Content types', () => {
  it('only admins change types', async () => {
    await expect((typesPost as Handler)(as(editorId, { action: 'create', name: 'X', singularName: 'X', slug: 'x' }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates a type with fields, and lists them', async () => {
    const id = await createPropertyType()
    const { types } = await (typesGet as Handler)(as(editorId)) as { types: Array<{ id: string; fields: Array<{ key: string }> }> }
    expect(types.find(t => t.id === id)!.fields.map(f => f.key)).toEqual(['price', 'bedrooms', 'amenities', 'internal_ref'])
  })

  it('refuses a duplicate key and bad fields', async () => {
    const id = await createPropertyType()
    const type = await getCurrentTestDb().query.contentTypes.findFirst({ where: eq(contentTypes.id, id) })
    await expect((typesPost as Handler)(as(adminId, { action: 'create', name: 'Again', singularName: 'Again', slug: type!.slug }))).rejects.toMatchObject({ statusCode: 409 })
    await expect((typesPost as Handler)(as(adminId, { action: 'update', id, fields: [{ key: 'a', label: 'A', type: 'select', options: [] }] }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('deletes an empty custom type, but not one in use or a built-in one', async () => {
    const id = await createPropertyType()
    const type = await getCurrentTestDb().query.contentTypes.findFirst({ where: eq(contentTypes.id, id) })
    await seedContentItem(getCurrentTestDb(), SITE, id, { slug: `in-use-${type!.slug}` })
    await expect((typesPost as Handler)(as(adminId, { action: 'delete', id }))).rejects.toMatchObject({ statusCode: 409 })

    const builtIn = await seedContentType(getCurrentTestDb(), SITE, { slug: 'post', name: 'Posts', singularName: 'Post', isBuiltIn: true })
    await expect((typesPost as Handler)(as(adminId, { action: 'delete', id: builtIn }))).rejects.toMatchObject({ statusCode: 403 })

    const empty = await createPropertyType()
    await (typesPost as Handler)(as(adminId, { action: 'delete', id: empty }))
    expect(await getCurrentTestDb().query.contentTypes.findFirst({ where: eq(contentTypes.id, empty) })).toBeUndefined()
  })
})

describe('values on items', () => {
  it('saves a half-filled draft, but needs required fields to publish', async () => {
    const typeId = await createPropertyType()
    const type = await getCurrentTestDb().query.contentTypes.findFirst({ where: eq(contentTypes.id, typeId) })
    const { id } = await (contentPost as Handler)(as(editorId, { title: 'Rose Cottage', slug: `rose-${type!.slug}`, typeSlug: type!.slug, status: 'draft', fields: { bedrooms: '3' } })) as { id: string }
    const row = await getCurrentTestDb().query.contentItems.findFirst({ where: and(eq(contentItems.id, id), eq(contentItems.siteId, SITE)) })
    expect(row!.fields).toEqual({ bedrooms: 3 })

    await expect((contentPatch as Handler)(as(editorId, { status: 'published', fields: { bedrooms: 3 } }, { id }))).rejects.toMatchObject({ statusCode: 422 })
    await (contentPatch as Handler)(as(editorId, { status: 'published', fields: { price: '250,000', bedrooms: 3, amenities: ['Garden'], internal_ref: 'RC-1' } }, { id }))

    const page = await (publicPage as Handler)(createMockEvent({ siteId: SITE, params: { slug: `rose-${type!.slug}` } }) as unknown as H3Event) as { details: Array<{ label: string; text: string }> }
    expect(page.details.map(d => [d.label, d.text])).toEqual([['Price', '£250,000'], ['Bedrooms', '3'], ['Amenities', 'Garden']])
  })

  it('refuses a value outside the choices', async () => {
    const typeId = await createPropertyType()
    const type = await getCurrentTestDb().query.contentTypes.findFirst({ where: eq(contentTypes.id, typeId) })
    await expect((contentPost as Handler)(as(editorId, { title: 'X', slug: `x-${type!.slug}`, typeSlug: type!.slug, fields: { amenities: ['Pool'] } })))
      .rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('backup', () => {
  it('carries each type\'s fields and each item\'s values', async () => {
    const typeId = await createPropertyType()
    const type = await getCurrentTestDb().query.contentTypes.findFirst({ where: eq(contentTypes.id, typeId) })
    await seedContentItem(getCurrentTestDb(), SITE, typeId, { slug: `backed-${type!.slug}`, fields: { price: 1, bedrooms: 2 } })
    const backup = await buildBackup(as(adminId), SITE)
    expect(backup.contentTypes.find(t => t.slug === type!.slug)!.fields).toHaveLength(4)
    expect(backup.content.find(i => i.slug === `backed-${type!.slug}`)!.fields).toEqual({ price: 1, bedrooms: 2 })
  })
})
