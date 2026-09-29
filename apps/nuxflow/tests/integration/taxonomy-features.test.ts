/**
 * Integration tests for the taxonomy feature set beyond basic CRUD (taxonomies.test.ts):
 *  - slug rules: derived slugs, reserved/locale-shaped slugs, clashes with content slugs
 *  - content-type scoping, rename redirects, hierarchy flattening, parent-cycle rejection
 *  - term ordering, per-term SEO fields, child promotion on delete
 *  - terms saved with content create/update (termIds), admin list `term` filter
 *  - public archive roll-up of sub-terms, breadcrumbs, correct item paths, overview
 *    counts, posts API filters, page API terms, per-term RSS, sitemap entries
 *  - MCP list_taxonomies / set_content_terms
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { contentTaxonomyTerms, redirects, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/analytics', () => ({ trackPageView: vi.fn() }))

const { default: createTaxonomy } = await import('../../server/api/v1/taxonomies/index.post')
const { default: listTaxonomies } = await import('../../server/api/v1/taxonomies/index.get')
const { default: patchTaxonomy } = await import('../../server/api/v1/taxonomies/[id].patch')
const { default: listTerms } = await import('../../server/api/v1/taxonomies/[id]/terms.get')
const { default: createTerm } = await import('../../server/api/v1/taxonomies/[id]/terms.post')
const { default: patchTerm } = await import('../../server/api/v1/taxonomies/[id]/terms/[termId].patch')
const { default: deleteTerm } = await import('../../server/api/v1/taxonomies/[id]/terms/[termId].delete')
const { default: createContent } = await import('../../server/api/v1/content/index.post')
const { default: patchContent } = await import('../../server/api/v1/content/[id].patch')
const { default: getContent } = await import('../../server/api/v1/content/[id].get')
const { default: listContent } = await import('../../server/api/v1/content/index.get')
const { default: archiveHandler } = await import('../../server/api/public/taxonomy/[taxonomySlug]/[termSlug].get')
const { default: overviewHandler } = await import('../../server/api/public/taxonomy/[taxonomySlug]/index.get')
const { default: postsHandler } = await import('../../server/api/public/posts.get')
const { default: pageHandler } = await import('../../server/api/public/pages/[...slug].get')
const { default: feedHandler } = await import('../../server/routes/feed.xml')
const { getTaxonomyArchiveEntries } = await import('../../server/utils/sitemap-entries')
const { callTool } = await import('../../server/utils/mcp-tools')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-taxfeat-01'
const OTHER = 'site-taxfeat-02'
let editorId: string
let postTypeId: string
let pageTypeId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'taxfeat.localhost', locale: 'en' })
  await seedSite(db, { id: OTHER, domain: 'taxfeat2.localhost' })
  editorId = await seedUser(db, { email: 'editor@taxfeat.test' })
  await seedRole(db, editorId, SITE, 'editor')
  postTypeId = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })
  pageTypeId = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
})

afterAll(teardownTestDb)

function ev(opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string>; siteId?: string; anon?: boolean } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: opts.anon ? null : { user: { id: editorId, name: 'Editor', email: 'editor@taxfeat.test' } },
    body: opts.body,
    params: opts.params,
    query: opts.query,
  }) as unknown as H3Event
}

async function newTaxonomy(body: Record<string, unknown>) {
  return await (createTaxonomy as Handler)(ev({ body })) as { id: string; slug: string }
}
async function newTerm(taxonomyId: string, body: Record<string, unknown>) {
  return await (createTerm as Handler)(ev({ params: { id: taxonomyId }, body })) as { id: string; slug: string }
}

// ── Taxonomy slugs & scoping ──────────────────────────────────────────────────

describe('taxonomy slugs', () => {
  it('derives the slug from the name when omitted', async () => {
    const res = await newTaxonomy({ name: 'Café Topics' })
    expect(res.slug).toBe('cafe-topics')
  })

  it('rejects reserved and language-code-shaped slugs', async () => {
    await expect(newTaxonomy({ name: 'Blog', slug: 'blog' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(newTaxonomy({ name: 'Spanish', slug: 'es' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(newTaxonomy({ name: 'BR', slug: 'pt-br' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects a slug already used by a content item, and vice versa', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, pageTypeId, { slug: 'services' })
    await expect(newTaxonomy({ name: 'Services', slug: 'services' })).rejects.toMatchObject({ statusCode: 409 })

    await newTaxonomy({ name: 'Regions', slug: 'regions' })
    await expect((createContent as Handler)(ev({ body: { title: 'Regions', slug: 'regions', typeSlug: 'page' } })))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('stores and returns content-type scoping; unknown types are rejected', async () => {
    const { id } = await newTaxonomy({ name: 'Series', contentTypes: ['post'] })
    const list = await (listTaxonomies as Handler)(ev()) as { taxonomies: { id: string; contentTypes: string[] }[] }
    expect(list.taxonomies.find(t => t.id === id)?.contentTypes).toEqual(['post'])

    await expect(newTaxonomy({ name: 'Bad', contentTypes: ['nope'] })).rejects.toMatchObject({ statusCode: 422 })

    await (patchTaxonomy as Handler)(ev({ params: { id }, body: { contentTypes: [] } }))
    const after = await (listTaxonomies as Handler)(ev()) as { taxonomies: { id: string; contentTypes: string[] }[] }
    expect(after.taxonomies.find(t => t.id === id)?.contentTypes).toEqual([])
  })

  it('renaming a taxonomy 301s its overview and every term archive', async () => {
    const { id } = await newTaxonomy({ name: 'Topics', slug: 'topics' })
    await newTerm(id, { name: 'Nuxt' })
    await (patchTaxonomy as Handler)(ev({ params: { id }, body: { slug: 'subjects' } }))

    const db = getCurrentTestDb()
    const rows = await db.select().from(redirects).where(eq(redirects.siteId, SITE))
    const map = Object.fromEntries(rows.map(r => [r.from, r.to]))
    expect(map['/topics']).toBe('/subjects')
    expect(map['/topics/nuxt']).toBe('/subjects/nuxt')
  })

  it('turning hierarchy off flattens every nested term', async () => {
    const { id } = await newTaxonomy({ name: 'Sections', isHierarchical: true })
    const parent = await newTerm(id, { name: 'Parent' })
    const child = await newTerm(id, { name: 'Child', parentId: parent.id })
    await (patchTaxonomy as Handler)(ev({ params: { id }, body: { isHierarchical: false } }))

    const db = getCurrentTestDb()
    const row = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, child.id) })
    expect(row?.parentId).toBeNull()
  })
})

// ── Terms ─────────────────────────────────────────────────────────────────────

describe('terms', () => {
  it('needs a typed slug when the name has no Latin letters or digits', async () => {
    const { id } = await newTaxonomy({ name: 'Keywords' })
    await expect(newTerm(id, { name: '日本語' })).rejects.toMatchObject({ statusCode: 422 })
    const ok = await newTerm(id, { name: '日本語', slug: 'japanese' })
    expect(ok.slug).toBe('japanese')
  })

  it('rejects a parent on a flat taxonomy', async () => {
    const { id } = await newTaxonomy({ name: 'Flat labels' })
    const a = await newTerm(id, { name: 'A' })
    await expect(newTerm(id, { name: 'B', parentId: a.id })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects a parent cycle deeper than self-parenting', async () => {
    const { id } = await newTaxonomy({ name: 'Tree', isHierarchical: true })
    const a = await newTerm(id, { name: 'A' })
    const b = await newTerm(id, { name: 'B', parentId: a.id })
    const c = await newTerm(id, { name: 'C', parentId: b.id })
    await expect((patchTerm as Handler)(ev({ params: { id, termId: a.id }, body: { parentId: c.id } })))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('appends new terms to the manual order and lists by it, with usage counts', async () => {
    const { id } = await newTaxonomy({ name: 'Ordered' })
    const z = await newTerm(id, { name: 'Zeta' })
    const a = await newTerm(id, { name: 'Alpha' })
    const db = getCurrentTestDb()
    const item = await seedContentItem(db, SITE, postTypeId)
    await db.insert(contentTaxonomyTerms).values({ contentItemId: item, termId: a.id })

    const res = await (listTerms as Handler)(ev({ params: { id } })) as { terms: { id: string; count: number; sortOrder: number }[] }
    expect(res.terms.map(t => t.id)).toEqual([z.id, a.id])
    expect(res.terms.find(t => t.id === a.id)?.count).toBe(1)
  })

  it('renames a term slug with a redirect, and clears optional fields with an empty string', async () => {
    const { id, slug } = await newTaxonomy({ name: 'Renames' })
    const t = await newTerm(id, { name: 'Old', description: 'desc', seoTitle: 'SEO' })
    await (patchTerm as Handler)(ev({ params: { id, termId: t.id }, body: { slug: 'new-slug', description: '', seoTitle: '' } }))

    const db = getCurrentTestDb()
    const row = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, t.id) })
    expect(row).toMatchObject({ slug: 'new-slug', description: null, seoTitle: null })
    const r = await db.query.redirects.findFirst({ where: and(eq(redirects.siteId, SITE), eq(redirects.from, `/${slug}/old`)) })
    expect(r?.to).toBe(`/${slug}/new-slug`)
  })

  it('moves children up to the deleted term\'s own parent', async () => {
    const { id } = await newTaxonomy({ name: 'Nest', isHierarchical: true })
    const root = await newTerm(id, { name: 'Root' })
    const mid = await newTerm(id, { name: 'Mid', parentId: root.id })
    const leaf = await newTerm(id, { name: 'Leaf', parentId: mid.id })
    await (deleteTerm as Handler)(ev({ params: { id, termId: mid.id } }))

    const db = getCurrentTestDb()
    const row = await db.query.taxonomyTerms.findFirst({ where: eq(taxonomyTerms.id, leaf.id) })
    expect(row?.parentId).toBe(root.id)
  })
})

// ── Content ↔ terms ───────────────────────────────────────────────────────────

describe('content termIds', () => {
  it('assigns terms on create, replaces them on PATCH, and returns them from GET', async () => {
    const { id } = await newTaxonomy({ name: 'Labels' })
    const t1 = await newTerm(id, { name: 'One' })
    const t2 = await newTerm(id, { name: 'Two' })

    const created = await (createContent as Handler)(ev({
      body: { title: 'Tagged', slug: `tagged-${ulid().toLowerCase()}`, typeSlug: 'post', termIds: [t1.id, t1.id] },
    })) as { id: string }
    let got = await (getContent as Handler)(ev({ params: { id: created.id } })) as { termIds: string[] }
    expect(got.termIds).toEqual([t1.id])

    await (patchContent as Handler)(ev({ params: { id: created.id }, body: { termIds: [t2.id] } }))
    got = await (getContent as Handler)(ev({ params: { id: created.id } })) as { termIds: string[] }
    expect(got.termIds).toEqual([t2.id])

    // Omitting termIds leaves them alone.
    await (patchContent as Handler)(ev({ params: { id: created.id }, body: { title: 'Renamed' } }))
    got = await (getContent as Handler)(ev({ params: { id: created.id } })) as { termIds: string[] }
    expect(got.termIds).toEqual([t2.id])
  })

  it('rejects another site\'s term on create', async () => {
    const db = getCurrentTestDb()
    const foreignTax = ulid()
    const foreignTerm = ulid()
    await db.insert(taxonomies).values({ id: foreignTax, siteId: OTHER, slug: 'x', name: 'X' })
    await db.insert(taxonomyTerms).values({ id: foreignTerm, taxonomyId: foreignTax, slug: 'y', name: 'Y' })
    await expect((createContent as Handler)(ev({
      body: { title: 'Bad', slug: `bad-${ulid().toLowerCase()}`, typeSlug: 'post', termIds: [foreignTerm] },
    }))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('filters the admin content list by term', async () => {
    const { id } = await newTaxonomy({ name: 'Filterable' })
    const t = await newTerm(id, { name: 'Pick me' })
    const db = getCurrentTestDb()
    const tagged = await seedContentItem(db, SITE, postTypeId)
    await seedContentItem(db, SITE, postTypeId)
    await db.insert(contentTaxonomyTerms).values({ contentItemId: tagged, termId: t.id })

    const res = await (listContent as Handler)(ev({ query: { type: 'post', term: t.id } })) as { items: { id: string }[] }
    expect(res.items.map(i => i.id)).toEqual([tagged])
  })
})

// ── Public surfaces ───────────────────────────────────────────────────────────

describe('public taxonomy pages', () => {
  let taxSlug: string
  let parentSlug: string
  let childSlug: string
  let parentItem: string
  let childItem: string
  let translation: string

  beforeAll(async () => {
    const db = getCurrentTestDb()
    const tax = await newTaxonomy({ name: 'Kinds', slug: 'kinds', isHierarchical: true })
    taxSlug = tax.slug
    const parent = await newTerm(tax.id, { name: 'Fruit', slug: 'fruit', seoTitle: 'All about fruit' })
    const child = await newTerm(tax.id, { name: 'Citrus', slug: 'citrus', parentId: parent.id })
    parentSlug = parent.slug
    childSlug = child.slug
    parentItem = await seedContentItem(db, SITE, postTypeId, { slug: 'apples', title: 'Apples' })
    childItem = await seedContentItem(db, SITE, postTypeId, { slug: 'lemons', title: 'Lemons' })
    translation = await seedContentItem(db, SITE, postTypeId, { slug: 'lemons-es', title: 'Limones', locale: 'es', sourceItemId: childItem })
    const hidden = await seedContentItem(db, SITE, postTypeId, { slug: 'secret-fruit', status: 'draft' })
    await db.insert(contentTaxonomyTerms).values([
      { contentItemId: parentItem, termId: parent.id },
      { contentItemId: childItem, termId: child.id },
      // Tagged with both parent and child — must still be listed once.
      { contentItemId: childItem, termId: parent.id },
      { contentItemId: translation, termId: child.id },
      { contentItemId: hidden, termId: parent.id },
    ])
  })

  it('a parent archive rolls up its sub-terms\' content, once each, with correct paths', async () => {
    const res = await (archiveHandler as Handler)(ev({ anon: true, params: { taxonomySlug: taxSlug, termSlug: parentSlug } })) as {
      total: number; items: { id: string; path: string }[]; children: { slug: string }[]; term: { seoTitle: string | null }
    }
    expect(res.total).toBe(3)
    expect(res.items.map(i => i.id).sort()).toEqual([parentItem, childItem, translation].sort())
    expect(res.items.find(i => i.id === translation)?.path).toBe('/es/lemons')
    expect(res.children.map(c => c.slug)).toEqual([childSlug])
    expect(res.term.seoTitle).toBe('All about fruit')
  })

  it('a child archive has breadcrumbs back to its parent', async () => {
    const res = await (archiveHandler as Handler)(ev({ anon: true, params: { taxonomySlug: taxSlug, termSlug: childSlug } })) as {
      ancestors: { slug: string }[]; total: number
    }
    expect(res.ancestors.map(a => a.slug)).toEqual([parentSlug])
    expect(res.total).toBe(2)
  })

  it('the overview lists terms with rolled-up totals', async () => {
    const res = await (overviewHandler as Handler)(ev({ anon: true, params: { taxonomySlug: taxSlug } })) as {
      terms: { slug: string; count: number; total: number; parentSlug: string | null }[]
    }
    const fruit = res.terms.find(t => t.slug === parentSlug)!
    expect(fruit).toMatchObject({ count: 2, total: 3 })
    expect(res.terms.find(t => t.slug === childSlug)?.parentSlug).toBe(parentSlug)
  })

  it('the posts API filters by taxonomy term (sub-terms included) and by type', async () => {
    const res = await (postsHandler as Handler)(ev({ anon: true, query: { taxonomy: taxSlug, term: parentSlug, type: 'post' } })) as {
      posts: { id: string }[]; total: number
    }
    expect(res.total).toBe(3)
    const none = await (postsHandler as Handler)(ev({ anon: true, query: { taxonomy: taxSlug, term: 'nope' } })) as { total: number }
    expect(none.total).toBe(0)
  })

  it('the public page API returns the item\'s terms with archive paths', async () => {
    const res = await (pageHandler as Handler)(ev({ anon: true, params: { slug: 'lemons' } })) as {
      terms: { termSlug: string; path: string }[]
    }
    expect(res.terms.map(t => t.path).sort()).toEqual([`/${taxSlug}/${childSlug}`, `/${taxSlug}/${parentSlug}`].sort())
  })

  it('serves a per-term RSS feed and 404s an unknown term', async () => {
    const xml = await (feedHandler as Handler)(ev({ anon: true, query: { taxonomy: taxSlug, term: childSlug } })) as string
    expect(xml).toContain('Lemons')
    expect(xml).not.toContain('Apples')
    expect(xml).toContain('Citrus')
    await expect((feedHandler as Handler)(ev({ anon: true, query: { taxonomy: taxSlug, term: 'missing' } })))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('the sitemap lists term archives (parents via roll-up) and the overview, skipping noindex taxonomies', async () => {
    const db = getCurrentTestDb()
    const entries = await getTaxonomyArchiveEntries(db, SITE, 1000)
    const paths = entries.map(e => e.path)
    expect(paths).toEqual(expect.arrayContaining([`/${taxSlug}/${parentSlug}`, `/${taxSlug}/${childSlug}`, `/${taxSlug}`]))

    const hiddenTax = await newTaxonomy({ name: 'Hidden', slug: 'hidden-tax', noindex: true })
    const hiddenTerm = await newTerm(hiddenTax.id, { name: 'H' })
    await db.insert(contentTaxonomyTerms).values({ contentItemId: parentItem, termId: hiddenTerm.id })
    const after = (await getTaxonomyArchiveEntries(db, SITE, 1000)).map(e => e.path)
    expect(after.some(p => p.startsWith('/hidden-tax'))).toBe(false)
  })
})

// ── MCP ───────────────────────────────────────────────────────────────────────

describe('MCP taxonomy tools', () => {
  function mcpCtx() {
    const event = createMockEvent({ siteId: SITE, apiKeyUserId: editorId, apiKeyRole: 'editor', apiKeyScopes: ['read:content', 'write:content'] }) as unknown as H3Event
    return { event, db: getCurrentTestDb(), siteId: SITE, apiKeyUserId: editorId, apiKeyRole: 'editor' }
  }

  it('lists taxonomies with term paths and sets an item\'s terms by path', async () => {
    const { id } = await newTaxonomy({ name: 'Mcp tags', slug: 'mcp-tags' })
    await newTerm(id, { name: 'Agents', slug: 'agents' })
    const db = getCurrentTestDb()
    const item = await seedContentItem(db, SITE, postTypeId, { authorId: editorId })

    const listed = await callTool('list_taxonomies', {}, mcpCtx() as never)
    expect(listed.content[0]!.text).toContain('mcp-tags/agents')

    const set = await callTool('set_content_terms', { id: item, terms: ['mcp-tags/agents'] }, mcpCtx() as never)
    expect(set.content[0]!.text).toMatch(/^Success/)
    const rows = await db.select().from(contentTaxonomyTerms).where(eq(contentTaxonomyTerms.contentItemId, item))
    expect(rows).toHaveLength(1)

    const bad = await callTool('set_content_terms', { id: item, terms: ['mcp-tags/nope'] }, mcpCtx() as never)
    expect(bad.content[0]!.text).toContain('Unknown term')
  })
})
