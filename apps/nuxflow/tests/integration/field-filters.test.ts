/**
 * Filtering and sorting public listings by a type's custom fields (GET /api/public/posts):
 * number ranges, choices, yes/no, sorting by a number, cards' details, and nothing a field
 * marked "not on the page" leaking into a listing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedContentType, seedContentItem } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/edge-cache', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withEdgeCache: (_e: unknown, _ttl: number, build: () => unknown) => build(),
}))

const { default: postsRoute } = await import('../../server/api/public/posts.get')

const SITE = 'site-field-filters-01'

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'field-filters.localhost' })
  const typeId = await seedContentType(db, SITE, {
    slug: 'property', name: 'Properties', singularName: 'Property',
    schema: { fields: [
      { key: 'price', label: 'Price', type: 'number', prefix: '£', filterable: true },
      { key: 'bedrooms', label: 'Bedrooms', type: 'number', filterable: true },
      { key: 'kind', label: 'Kind', type: 'select', options: ['House', 'Flat'], filterable: true },
      { key: 'amenities', label: 'Amenities', type: 'multiselect', options: ['Parking', 'Garden'], filterable: true },
      { key: 'garden', label: 'Garden', type: 'boolean', filterable: true },
      { key: 'ref', label: 'Reference', type: 'text', showOnPage: false },
      { key: 'notes', label: 'Notes', type: 'number' },
    ] },
  })
  const add = (slug: string, fields: Record<string, unknown>) => seedContentItem(db, SITE, typeId, { slug, title: slug, status: 'published', visibility: 'public', fields: fields as never })
  await add('cottage', { price: 250000, bedrooms: 3, kind: 'House', amenities: ['Parking', 'Garden'], garden: true, ref: 'SECRET-1' })
  await add('flat', { price: 180000, bedrooms: 1, kind: 'Flat', amenities: ['Parking'], ref: 'SECRET-2' })
  await add('manor', { price: 900000, bedrooms: 6, kind: 'House', amenities: ['Garden'], garden: true })
  await add('plot', { kind: 'House' })
})
afterAll(teardownTestDb)

type Result = { posts: Array<{ slug: string; details?: Array<{ label: string; text: string }> }>; total: number; filters?: Array<{ key: string }> }
const list = async (query: Record<string, string>) => await (postsRoute as (e: H3Event) => Promise<unknown>)(
  createMockEvent({ siteId: SITE, query: { type: 'property', ...query } }) as unknown as H3Event,
) as Result
const slugs = (r: Result) => r.posts.map(p => p.slug).sort()

describe('filters', () => {
  it('filters by a number range', async () => {
    expect(slugs(await list({ 'f.price.min': '200000', 'f.price.max': '500000' }))).toEqual(['cottage'])
    expect(slugs(await list({ 'f.bedrooms.min': '3' }))).toEqual(['cottage', 'manor'])
  })

  it('filters by one choice, several choices (all of them) and yes/no', async () => {
    expect(slugs(await list({ 'f.kind': 'Flat' }))).toEqual(['flat'])
    expect(slugs(await list({ 'f.amenities': 'Parking,Garden' }))).toEqual(['cottage'])
    expect(slugs(await list({ 'f.garden': '1' }))).toEqual(['cottage', 'manor'])
  })

  it('ignores unknown, unfilterable or unusable filters', async () => {
    expect((await list({ 'f.kind': 'Castle' })).total).toBe(4)
    expect((await list({ 'f.notes.min': '5', 'f.nope': 'x', 'f.price.min': 'lots' })).total).toBe(4)
  })

  it('sorts by a number, items without one last', async () => {
    expect((await list({ sort: 'f.price' })).posts.map(p => p.slug)).toEqual(['flat', 'cottage', 'manor', 'plot'])
    expect((await list({ sort: '-f.price' })).posts.map(p => p.slug)).toEqual(['manor', 'cottage', 'flat', 'plot'])
  })

  it('lists the filters the type offers, and gives cards their details without hidden fields', async () => {
    const res = await list({ 'f.kind': 'Flat' })
    expect(res.filters!.map(f => f.key)).toEqual(['price', 'bedrooms', 'kind', 'amenities', 'garden'])
    expect(res.posts[0]!.details!.map(d => d.text)).toEqual(['£180,000', '1', 'Flat', 'Parking'])
    expect(JSON.stringify(res)).not.toContain('SECRET')
  })
})
