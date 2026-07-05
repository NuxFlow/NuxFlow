/**
 * Integration tests for GET /api/v1/search and the search_index sync triggers
 * added in migrations/0002_search_index.sql. The FTS5 index has no application-level
 * indexing code — it's maintained entirely by SQLite triggers on content_items, so
 * these tests exercise the triggers indirectly via ordinary content writes.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { contentItems } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedContentType, seedContentItem } from '../helpers/seed'
import handler from '../../server/api/v1/search.get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-search-01'
let typeId: string

type HandlerFn = (e: H3Event) => Promise<{ results: unknown[] }>

function mkEvent(q: string) {
  return createMockEvent({ siteId: SITE, query: { q } }) as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'search.localhost' })
  typeId = await seedContentType(db, SITE)
})

afterAll(teardownTestDb)

describe('search_index triggers', () => {
  it('indexes a published, public item on insert', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, typeId, {
      title: 'Growing Tomatoes on the Edge',
      excerpt: 'A guide to greenhouse cultivation.',
      status: 'published',
      visibility: 'public',
    })

    const result = await (handler as HandlerFn)(mkEvent('tomatoes'))
    expect(result.results).toHaveLength(1)
    expect((result.results[0] as { title: string }).title).toBe('Growing Tomatoes on the Edge')
  })

  it('does not index draft or private items', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, typeId, {
      title: 'Unpublished Zucchini Notes',
      status: 'draft',
      visibility: 'public',
    })
    await seedContentItem(db, SITE, typeId, {
      title: 'Private Zucchini Notes',
      status: 'published',
      visibility: 'private',
    })

    const result = await (handler as HandlerFn)(mkEvent('zucchini'))
    expect(result.results).toHaveLength(0)
  })

  it('removes an item from the index when it is unpublished', async () => {
    const db = getCurrentTestDb()
    const id = await seedContentItem(db, SITE, typeId, {
      title: 'Seasonal Pumpkin Roundup',
      status: 'published',
      visibility: 'public',
    })

    expect((await (handler as HandlerFn)(mkEvent('pumpkin'))).results).toHaveLength(1)

    await db.update(contentItems).set({ status: 'draft' }).where(eq(contentItems.id, id))

    expect((await (handler as HandlerFn)(mkEvent('pumpkin'))).results).toHaveLength(0)
  })

  it('removes an item from the index when it is deleted', async () => {
    const db = getCurrentTestDb()
    const id = await seedContentItem(db, SITE, typeId, {
      title: 'Basil Companion Planting',
      status: 'published',
      visibility: 'public',
    })

    expect((await (handler as HandlerFn)(mkEvent('basil'))).results).toHaveLength(1)

    await db.delete(contentItems).where(eq(contentItems.id, id))

    expect((await (handler as HandlerFn)(mkEvent('basil'))).results).toHaveLength(0)
  })
})

describe('GET /api/v1/search', () => {
  it('returns an empty result set for a query shorter than 2 characters', async () => {
    const result = await (handler as HandlerFn)(mkEvent('a'))
    expect(result.results).toEqual([])
  })

  it('splits the excerpt into text segments rather than returning raw HTML', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, typeId, {
      title: 'Carrot Growing Guide',
      excerpt: 'Everything about growing carrots in raised beds.',
      status: 'published',
      visibility: 'public',
    })

    const result = await (handler as HandlerFn)(mkEvent('carrots'))
    expect(result.results).toHaveLength(1)
    const segments = (result.results[0] as { excerptSegments: { text: string; highlighted: boolean }[] }).excerptSegments
    expect(segments.some(s => s.highlighted && s.text.toLowerCase().includes('carrot'))).toBe(true)
    // No segment should still contain a raw <mark> tag — it must have been parsed
    // out into the `highlighted` flag, not left in the text.
    expect(segments.every(s => !s.text.includes('<mark>') && !s.text.includes('</mark>'))).toBe(true)
  })

  it('preserves HTML-like content in an excerpt as literal text, not markup (stored XSS regression guard)', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, typeId, {
      title: 'Radish Notes',
      excerpt: '<img src=x onerror=alert(1)> radish planting tips',
      status: 'published',
      visibility: 'public',
    })

    const result = await (handler as HandlerFn)(mkEvent('radish'))
    expect(result.results).toHaveLength(1)
    const segments = (result.results[0] as { excerptSegments: { text: string; highlighted: boolean }[] }).excerptSegments
    // The malicious markup must survive as inert text data somewhere in the
    // segments — proving it was never treated as HTML server-side — and the
    // frontend renders segments with {{ }} interpolation, never v-html.
    const joined = segments.map(s => s.text).join('')
    expect(joined).toContain('<img src=x onerror=alert(1)>')
  })
})
