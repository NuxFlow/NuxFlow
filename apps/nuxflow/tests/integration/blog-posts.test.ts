import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedContentType, seedContentItem } from '../helpers/seed'
import handler from '../../server/api/public/posts.get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-blog-posts-01'
let typeId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'blog.localhost' })
  typeId = await seedContentType(db, SITE, { slug: 'post', name: 'Post', singularName: 'Post' })

  // Seed 12 published public posts, plus 1 draft and 1 members-only
  for (let i = 1; i <= 12; i++) {
    await seedContentItem(db, SITE, typeId, {
      slug: `post-${i}`,
      title: `Post ${i}`,
      status: 'published',
      visibility: 'public',
      excerpt: `Excerpt for post ${i}`,
      publishedAt: new Date(Date.now() - i * 60_000).toISOString(),
    })
  }
  await seedContentItem(db, SITE, typeId, { slug: 'draft-post', title: 'Draft', status: 'draft', visibility: 'public' })
  await seedContentItem(db, SITE, typeId, { slug: 'private-post', title: 'Private', status: 'published', visibility: 'members' })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

interface PostsResponse {
  posts: { id: string; title: string; slug: string; excerpt: string | null; ogImage: string | null; publishedAt: string | null }[]
  total: number
  page: number
  limit: number
  totalPages: number
}

function mkEvent(query: Record<string, string> = {}) {
  return createMockEvent({ siteId: SITE, query }) as unknown as H3Event
}

describe('GET /api/public/posts', () => {
  it('returns only published public posts', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as PostsResponse
    expect(result.total).toBe(12)
    expect(result.posts.every(p => p.slug !== 'draft-post')).toBe(true)
    expect(result.posts.every(p => p.slug !== 'private-post')).toBe(true)
  })

  it('defaults to page 1 with 10 items', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as PostsResponse
    expect(result.page).toBe(1)
    expect(result.limit).toBe(10)
    expect(result.posts.length).toBe(10)
    expect(result.totalPages).toBe(2)
  })

  it('returns second page with remaining items', async () => {
    const result = await (handler as HandlerFn)(mkEvent({ page: '2' })) as PostsResponse
    expect(result.page).toBe(2)
    expect(result.posts.length).toBe(2)
  })

  it('returns posts in reverse-chronological order', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as PostsResponse
    const dates = result.posts.map(p => new Date(p.publishedAt!).getTime())
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1])
    }
  })

  it('includes excerpt field', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as PostsResponse
    expect(result.posts[0].excerpt).toMatch(/^Excerpt for post/)
  })

  it('respects custom limit', async () => {
    const result = await (handler as HandlerFn)(mkEvent({ limit: '5' })) as PostsResponse
    expect(result.posts.length).toBe(5)
    expect(result.totalPages).toBe(3)
  })
})
