/**
 * Integration tests for the batched WordPress import routes
 * (server/api/v1/import/wordpress/{terms,term-parents,media,items,finish}.post.ts). The
 * browser drives them one batch at a time; each must be safe to retry.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { contentItems, contentTaxonomyTerms, media, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// Stand-in for fetching images from the WordPress site.
const fetched: string[] = []
vi.mock('../../server/utils/ssrf', () => ({
  isSafeUrl: (url: string) => !url.includes('localhost'),
  safeFetch: async (url: string) => {
    fetched.push(url)
    if (url.includes('missing')) return new Response('nope', { status: 404 })
    return new Response(new Uint8Array([0x89, 0x50, 0x4E, 0x47]), { headers: { 'content-type': 'image/png' } })
  },
}))

const { default: termsHandler } = await import('../../server/api/v1/import/wordpress/terms.post')
const { default: parentsHandler } = await import('../../server/api/v1/import/wordpress/term-parents.post')
const { default: mediaHandler } = await import('../../server/api/v1/import/wordpress/media.post')
const { default: itemsHandler } = await import('../../server/api/v1/import/wordpress/items.post')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-wp-import-01'
const OTHER = 'site-wp-import-02'
const NO_TYPES = 'site-wp-import-03'
let adminId: string
let editorId: string
let foreignTermId: string

function call<T>(handler: unknown, body: unknown, opts: { siteId?: string; userId?: string } = {}): Promise<T> {
  const event = createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: { user: { id: opts.userId ?? adminId, name: 'Admin', email: 'admin@wp-import.test' } },
    body,
  }) as unknown as H3Event
  return (handler as Handler)(event) as Promise<T>
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  for (const [id, domain] of [[SITE, 'wp1.localhost'], [OTHER, 'wp2.localhost'], [NO_TYPES, 'wp3.localhost']] as const) {
    await seedSite(db, { id, domain })
  }
  adminId = await seedUser(db, { email: 'admin@wp-import.test' })
  editorId = await seedUser(db, { email: 'editor@wp-import.test' })
  for (const site of [SITE, OTHER, NO_TYPES]) await seedRole(db, adminId, site, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
  for (const site of [SITE, OTHER]) {
    await seedContentType(db, site, { slug: 'page', name: 'Pages', singularName: 'Page' })
    await seedContentType(db, site, { slug: 'post', name: 'Posts', singularName: 'Post' })
  }
  // A term on another site, to prove items can't be attached to it.
  const otherTerms = await call<{ ids: Record<string, string> }>(termsHandler, { importId: 'x', taxonomy: 'tag', terms: [{ slug: 'theirs', name: 'Theirs' }] }, { siteId: OTHER })
  foreignTermId = otherTerms.ids.theirs!
})
afterAll(teardownTestDb)

beforeEach(() => {
  fetched.length = 0
})

describe('terms step', () => {
  it('creates the taxonomies and terms, and reuses existing ones on a retry', async () => {
    const body = { importId: 'imp-1', taxonomy: 'category', terms: [{ slug: 'news', name: 'News' }, { slug: 'sport', name: 'Sport' }] }
    const first = await call<{ ids: Record<string, string>; created: number }>(termsHandler, body)
    expect(first.created).toBe(2)

    const again = await call<{ ids: Record<string, string>; created: number }>(termsHandler, body)
    expect(again.created).toBe(0)
    expect(again.ids).toEqual(first.ids)

    const db = getCurrentTestDb()
    const category = await db.query.taxonomies.findFirst({ where: and(eq(taxonomies.siteId, SITE), eq(taxonomies.slug, 'category')) })
    expect(category?.isHierarchical).toBe(true)
  })

  it('creates the taxonomy even with no terms (the browser always calls both)', async () => {
    await call(termsHandler, { importId: 'imp-1', taxonomy: 'tag', terms: [] })
    const tag = await getCurrentTestDb().query.taxonomies.findFirst({ where: and(eq(taxonomies.siteId, SITE), eq(taxonomies.slug, 'tag')) })
    expect(tag).toBeTruthy()
  })

  it('fails up front on a site without page/post types — before any media is uploaded', async () => {
    await expect(call(termsHandler, { importId: 'imp-1', taxonomy: 'tag', terms: [] }, { siteId: NO_TYPES }))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('is admin-only', async () => {
    await expect(call(termsHandler, { importId: 'imp-1', taxonomy: 'tag', terms: [] }, { userId: editorId }))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('term-parents step', () => {
  it('links a category to its parent, and ignores a link to itself', async () => {
    const { ids } = await call<{ ids: Record<string, string> }>(termsHandler, {
      importId: 'imp-2', taxonomy: 'category', terms: [{ slug: 'parent', name: 'Parent' }, { slug: 'child', name: 'Child' }],
    })
    const res = await call<{ linked: number }>(parentsHandler, {
      importId: 'imp-2', links: [{ slug: 'child', parentSlug: 'parent' }, { slug: 'parent', parentSlug: 'parent' }],
    })
    expect(res.linked).toBe(1)
    const child = await getCurrentTestDb().query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, ids.child!) })
    expect(child?.parentId).toBe(ids.parent)
  })
})

describe('media step', () => {
  it('imports each file once — a retried batch reuses what the first attempt stored', async () => {
    const body = { importId: 'imp-3', urls: ['https://wp.example/a.png', 'https://wp.example/missing.png', 'http://localhost/x.png'] }
    const first = await call<{ results: { url: string; localUrl?: string; error?: string }[] }>(mediaHandler, body)
    expect(first.results[0]!.localUrl).toBeTruthy()
    expect(first.results[1]!.error).toBe('HTTP 404')
    expect(first.results[2]!.error).toBe('Not a public URL')

    fetched.length = 0
    const again = await call<{ results: { url: string; localUrl?: string }[] }>(mediaHandler, body)
    expect(again.results[0]!.localUrl).toBe(first.results[0]!.localUrl)
    expect(fetched).not.toContain('https://wp.example/a.png')

    const rows = await getCurrentTestDb().query.media.findMany({ where: eq(media.siteId, SITE) })
    expect(rows.filter(r => r.originalName === 'a.png')).toHaveLength(1)
  })
})

describe('items step', () => {
  it('creates posts and pages with their terms, skipping slugs the site already has', async () => {
    const db = getCurrentTestDb()
    const postType = await db.query.contentTypes.findFirst({ where: (t, { and: a, eq: e }) => a(e(t.siteId, SITE), e(t.slug, 'post')) })
    await seedContentItem(db, SITE, postType!.id, { slug: 'already-here', title: 'Existing' })
    const { ids } = await call<{ ids: Record<string, string> }>(termsHandler, { importId: 'imp-4', taxonomy: 'tag', terms: [{ slug: 'fresh', name: 'Fresh' }] })

    const item = (slug: string, extra: Record<string, unknown> = {}) => ({
      slug, title: slug, status: 'published', postType: 'post', content: '<p>Hello <strong>there</strong></p>',
      excerpt: '', publishedAt: null, ogImage: null, termIds: [], ...extra,
    })
    const res = await call<{ imported: number; skipped: number }>(itemsHandler, {
      importId: 'imp-4',
      items: [
        item('first-post', { termIds: [ids.fresh, foreignTermId] }),
        item('about', { postType: 'page', status: 'draft' }),
        item('already-here'),
      ],
    })
    expect(res).toEqual({ imported: 2, skipped: 1 })

    const created = await db.query.contentItems.findFirst({ where: and(eq(contentItems.siteId, SITE), eq(contentItems.slug, 'first-post')) })
    expect(created?.status).toBe('published')
    expect(JSON.stringify(created?.content)).toContain('there')
    const links = await db.query.contentTaxonomyTerms.findMany({ where: eq(contentTaxonomyTerms.contentItemId, created!.id) })
    // Another site's term is dropped, never attached.
    expect(links.map(l => l.termId)).toEqual([ids.fresh])

    const again = await call<{ imported: number; skipped: number }>(itemsHandler, { importId: 'imp-4', items: [item('first-post')] })
    expect(again).toEqual({ imported: 0, skipped: 1 })
  })

  it('rejects a batch over the size limit', async () => {
    const items = Array.from({ length: 26 }, (_, i) => ({
      slug: `bulk-${i}`, title: 't', status: 'draft', postType: 'post', content: '', excerpt: '', publishedAt: null, ogImage: null, termIds: [],
    }))
    await expect(call(itemsHandler, { importId: 'imp-5', items })).rejects.toMatchObject({ statusCode: 422 })
  })
})
