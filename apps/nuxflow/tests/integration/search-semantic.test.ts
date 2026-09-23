/**
 * Integration tests for GET /api/v1/search/semantic and GET /api/v1/content/:id/related —
 * both thin routes over server/utils/embeddings.ts's semanticSearch() (tested directly and
 * in more depth in embeddings.test.ts). These tests focus on the routes' own logic: the
 * `available: false` contract when Vectorize isn't configured, slug resolution, and
 * self-exclusion for "related content".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const mockSemanticSearch = vi.fn()
vi.mock('../../server/utils/embeddings', () => ({
  semanticSearch: (...args: unknown[]) => mockSemanticSearch(...args),
}))

const { default: semanticSearchHandler } = await import('../../server/api/v1/search/semantic.get')
const { default: relatedHandler } = await import('../../server/api/v1/content/[id]/related.get')

const SITE = 'site-semantic-01'
let typeId: string
let userId: string
let itemA: string
let itemB: string

type HandlerFn = (e: H3Event) => Promise<unknown>

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'semantic.localhost' })
  typeId = await seedContentType(db, SITE)
  userId = await seedUser(db, { email: 'editor@semantic.test' })
  await seedRole(db, userId, SITE, 'editor')
  itemA = await seedContentItem(db, SITE, typeId, { title: 'Growing Tomatoes', slug: 'growing-tomatoes' })
  itemB = await seedContentItem(db, SITE, typeId, { title: 'Companion Planting', slug: 'companion-planting' })
})

afterAll(teardownTestDb)

function publicEvent(q: string) {
  return createMockEvent({ siteId: SITE, query: { q } }) as unknown as H3Event
}

function editorEvent(params: Record<string, string>) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'Editor', email: 'editor@semantic.test' } },
    params,
  }) as unknown as H3Event
}

describe('GET /api/v1/search/semantic', () => {
  it('returns available:false when Vectorize is not configured, without erroring', async () => {
    mockSemanticSearch.mockResolvedValueOnce(null)
    const result = await (semanticSearchHandler as HandlerFn)(publicEvent('tomatoes')) as { available: boolean; results: unknown[] }
    expect(result.available).toBe(false)
    expect(result.results).toEqual([])
  })

  it('returns an empty result set for a too-short query without calling semanticSearch', async () => {
    const result = await (semanticSearchHandler as HandlerFn)(publicEvent('a')) as { available: boolean; results: unknown[] }
    expect(result.results).toEqual([])
    expect(mockSemanticSearch).not.toHaveBeenCalled()
  })

  it('resolves slugs for matched content items', async () => {
    mockSemanticSearch.mockResolvedValueOnce([{ contentItemId: itemA, score: 0.9, title: 'Growing Tomatoes' }])
    const result = await (semanticSearchHandler as HandlerFn)(publicEvent('tomatoes')) as {
      available: boolean
      results: { id: string; slug: string | null; title: string }[]
    }
    expect(result.available).toBe(true)
    expect(result.results).toEqual([{ id: itemA, title: 'Growing Tomatoes', score: 0.9, slug: 'growing-tomatoes' }])
  })

  it('drops a match whose content item no longer exists (deleted since embedding)', async () => {
    mockSemanticSearch.mockResolvedValueOnce([{ contentItemId: 'nonexistent-item-id', score: 0.5, title: 'Ghost' }])
    const result = await (semanticSearchHandler as HandlerFn)(publicEvent('ghost')) as { results: unknown[] }
    expect(result.results).toEqual([])
  })
})

describe('GET /api/v1/content/:id/related', () => {
  it('returns available:false when Vectorize is not configured', async () => {
    mockSemanticSearch.mockResolvedValueOnce(null)
    const result = await (relatedHandler as HandlerFn)(editorEvent({ id: itemA })) as { available: boolean }
    expect(result.available).toBe(false)
  })

  it('excludes the item itself from its own related-content results', async () => {
    mockSemanticSearch.mockResolvedValueOnce([
      { contentItemId: itemA, score: 0.99, title: 'Growing Tomatoes' }, // the item's own near-perfect self-match
      { contentItemId: itemB, score: 0.7, title: 'Companion Planting' },
    ])

    const result = await (relatedHandler as HandlerFn)(editorEvent({ id: itemA })) as {
      results: { id: string }[]
    }

    expect(result.results.some(r => r.id === itemA)).toBe(false)
    expect(result.results.some(r => r.id === itemB)).toBe(true)
  })

  it('queries using the item\'s own title/excerpt as the search text', async () => {
    mockSemanticSearch.mockResolvedValueOnce([])
    await (relatedHandler as HandlerFn)(editorEvent({ id: itemA }))

    const [, , queryText] = mockSemanticSearch.mock.calls.at(-1) as [unknown, unknown, string]
    expect(queryText).toContain('Growing Tomatoes')
  })

  it('throws 404 for a nonexistent content item', async () => {
    await expect(
      (relatedHandler as HandlerFn)(editorEvent({ id: 'nonexistent-item-id' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
