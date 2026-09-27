/**
 * Integration tests for the SEO/GEO/AI-crawler feature set:
 *   robots.txt modes, sitemap.xml (noindex, translations/hreflang, lastmod), llms.txt /
 *   llms-full.txt, /indexnow-key.txt, the Markdown alternate middleware, the SEO response-
 *   header middleware (noindex paths/hosts, Content-Signal, crawler tracking), the redirect
 *   middleware and redirect APIs, auto-redirect on slug change, IndexNow submission, SEO
 *   settings validation, and the audit/crawler admin routes.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedSetting } from '../helpers/seed'
import { contentTaxonomyTerms, crawlerHits, redirects, siteSettings, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/webpush', () => ({ broadcastPushToSite: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/embeddings', () => ({
  upsertContentEmbedding: vi.fn().mockResolvedValue(undefined),
  deleteContentEmbedding: vi.fn().mockResolvedValue(undefined),
}))

const { default: robotsHandler } = await import('../../server/routes/robots.txt')
const { default: sitemapHandler } = await import('../../server/routes/sitemap.xml')
const { default: llmsHandler } = await import('../../server/routes/llms.txt')
const { default: llmsFullHandler } = await import('../../server/routes/llms-full.txt')
const { default: indexnowKeyHandler } = await import('../../server/routes/indexnow-key.txt')
const { default: pageHandler } = await import('../../server/api/public/pages/[...slug].get')
const { default: seoHeaders } = await import('../../server/middleware/05.seo-headers')
const { default: markdownMiddleware } = await import('../../server/middleware/06.markdown')
const { default: redirectMiddleware } = await import('../../server/middleware/05.redirects')
const { default: redirectCreate } = await import('../../server/api/v1/redirects/index.post')
const { default: redirectPatch } = await import('../../server/api/v1/redirects/[id].patch')
const { default: redirectImport } = await import('../../server/api/v1/redirects/import.post')
const { default: contentPatch } = await import('../../server/api/v1/content/[id].patch')
const { default: settingsPatch } = await import('../../server/api/v1/settings/index.patch')
const { default: auditHandler } = await import('../../server/api/v1/seo/audit.get')
const { default: crawlersHandler } = await import('../../server/api/v1/seo/crawlers.get')
const { clearSeoSettingsCache } = await import('../../server/utils/seo')
const { clearRedirectCache } = await import('../../server/utils/redirect-cache')
const { submitToIndexNow } = await import('../../server/utils/indexnow')

type Handler = (e: H3Event) => Promise<unknown>
type MockEv = ReturnType<typeof createMockEvent> & { method?: string }

const SITE = 'site-seo-geo-01'
const DOMAIN = 'geo.localhost'
let adminId: string
let editorId: string
let pageType: string
let postType: string
let eventType: string
let aboutId: string

async function setSeo(siteId: string, key: string, value: unknown) {
  const db = getCurrentTestDb()
  await db.delete(siteSettings).where(and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)))
  await seedSetting(db, siteId, key, value as string)
  clearSeoSettingsCache(siteId)
}

async function clearSeo(siteId: string, key: string) {
  await getCurrentTestDb().delete(siteSettings).where(and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)))
  clearSeoSettingsCache(siteId)
}

function ev(opts: Parameters<typeof createMockEvent>[0] & { siteDomain?: string } = {}): H3Event {
  const e = createMockEvent({ siteId: SITE, ...opts, headers: { host: DOMAIN, ...opts.headers } }) as MockEv
  e.method = opts.method ?? 'GET'
  ;(e.context as Record<string, unknown>).siteDomain = opts.siteDomain ?? DOMAIN
  return e as unknown as H3Event
}

function adminEv(opts: Parameters<typeof createMockEvent>[0] = {}) {
  return ev({ ...opts, session: { user: { id: adminId, name: 'Admin', email: 'admin@geo.test' } } })
}

function editorEv(opts: Parameters<typeof createMockEvent>[0] = {}) {
  return ev({ ...opts, session: { user: { id: editorId, name: 'Editor', email: 'editor@geo.test' } } })
}

const headers = (e: H3Event) => (e as unknown as { _responseHeaders: Record<string, string | string[]> })._responseHeaders
const status = (e: H3Event) => (e as unknown as { _status?: number })._status
const redirectOf = (e: H3Event) => (e as unknown as { _redirect?: { url: string; code: number } })._redirect

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 2000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v !== undefined) return v
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise(r => setTimeout(r, 20))
  }
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: DOMAIN, name: 'Geo Site' })
  adminId = await seedUser(db, { name: 'Admin', email: 'admin@geo.test' })
  editorId = await seedUser(db, { name: 'Editor', email: 'editor@geo.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')

  pageType = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
  postType = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })
  eventType = await seedContentType(db, SITE, { slug: 'event', name: 'Events', singularName: 'Event' })

  await seedContentItem(db, SITE, pageType, { slug: 'home', title: 'Home', updatedAt: '2026-09-01 10:00:00' })
  aboutId = await seedContentItem(db, SITE, pageType, {
    slug: 'about',
    title: 'About us',
    locale: 'en',
    seoDescription: 'Who we are',
    updatedAt: '2026-09-02 11:22:33',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ABOUT-BODY-TEXT' }] }] },
  })
  await seedContentItem(db, SITE, pageType, {
    slug: 'about-es',
    title: 'Sobre nosotros',
    locale: 'es',
    sourceItemId: aboutId,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CUERPO' }] }] },
  })
  await seedContentItem(db, SITE, postType, { slug: 'first-post', title: 'First post', excerpt: 'Post [excerpt] *here*' })
  await seedContentItem(db, SITE, pageType, { slug: 'hidden', title: 'Hidden page', metaRobots: 'noindex,follow' })
  await seedContentItem(db, SITE, eventType, { slug: 'meetup', title: 'Meetup', eventStartAt: '2026-10-01T18:00:00.000Z' })
  await seedContentItem(db, SITE, pageType, { slug: 'members', title: 'Members page', visibility: 'members' })

  // Taxonomy: one term with published content, one empty.
  const taxId = ulid()
  await db.insert(taxonomies).values({ id: taxId, siteId: SITE, slug: 'category', name: 'Categories' })
  const usedTerm = ulid()
  await db.insert(taxonomyTerms).values([
    { id: usedTerm, taxonomyId: taxId, slug: 'news', name: 'News' },
    { id: ulid(), taxonomyId: taxId, slug: 'empty', name: 'Empty' },
  ])
  await db.insert(contentTaxonomyTerms).values({ contentItemId: aboutId, termId: usedTerm })
})

afterAll(teardownTestDb)
afterEach(() => { vi.unstubAllGlobals() })

// ---------------------------------------------------------------------------

describe('robots.txt', () => {
  it('writes a Content-Signal line, disallows private paths, and lists both sitemaps', async () => {
    const txt = await (robotsHandler as Handler)(ev()) as string
    expect(txt).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=yes')
    expect(txt).toContain('Disallow: /admin/')
    expect(txt).toContain('Disallow: /search$')
    expect(txt).toContain('Sitemap: https://geo.localhost/sitemap.xml')
    expect(txt).toContain('Sitemap: https://geo.localhost/sitemap-images.xml')
  })

  it('block-training blocks training crawlers but leaves AI search crawlers allowed', async () => {
    await setSeo(SITE, 'seo.ai_crawlers', 'block-training')
    const txt = await (robotsHandler as Handler)(ev()) as string
    expect(txt).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=no')
    expect(txt).toContain('User-agent: GPTBot')
    expect(txt).toContain('User-agent: Google-Extended')
    expect(txt).not.toContain('User-agent: Googlebot-Extended')
    expect(txt).not.toContain('User-agent: OAI-SearchBot')
    expect(txt).not.toContain('User-agent: PerplexityBot')
    await clearSeo(SITE, 'seo.ai_crawlers')
  })

  it('appends custom rules', async () => {
    await setSeo(SITE, 'seo.robots_custom', 'User-agent: Foo\nDisallow: /foo/')
    const txt = await (robotsHandler as Handler)(ev()) as string
    expect(txt).toContain('# Custom rules\nUser-agent: Foo\nDisallow: /foo/')
    await clearSeo(SITE, 'seo.robots_custom')
  })
})

describe('sitemap.xml', () => {
  it('lists the homepage once at /, never /home', async () => {
    const xml = await (sitemapHandler as Handler)(ev()) as string
    expect(xml.match(/<loc>https:\/\/geo\.localhost\/<\/loc>/g)).toHaveLength(1)
    expect(xml).not.toContain('<loc>https://geo.localhost/home</loc>')
  })

  it('writes ISO 8601 lastmod values', async () => {
    const xml = await (sitemapHandler as Handler)(ev()) as string
    expect(xml).toContain('<loc>https://geo.localhost/about</loc>\n    <lastmod>2026-09-02T11:22:33Z</lastmod>')
  })

  it('excludes noindexed and members-only items, and types hidden by default', async () => {
    let xml = await (sitemapHandler as Handler)(ev()) as string
    expect(xml).not.toContain('/hidden')
    expect(xml).not.toContain('/members')
    expect(xml).toContain('/meetup')
    await setSeo(SITE, 'seo.noindex_content_types', ['event'])
    xml = await (sitemapHandler as Handler)(ev()) as string
    expect(xml).not.toContain('/meetup')
    await clearSeo(SITE, 'seo.noindex_content_types')
  })

  it('lists translations at /{locale}/{source slug} with hreflang alternates', async () => {
    const xml = await (sitemapHandler as Handler)(ev()) as string
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
    expect(xml).toContain('<loc>https://geo.localhost/es/about</loc>')
    expect(xml).not.toContain('<loc>https://geo.localhost/about-es</loc>')
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="es" href="https://geo.localhost/es/about"/>')
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="en" href="https://geo.localhost/about"/>')
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://geo.localhost/about"/>')
  })

  it('only lists taxonomy archives that have published content, unless archives are hidden', async () => {
    let xml = await (sitemapHandler as Handler)(ev()) as string
    expect(xml).toContain('<loc>https://geo.localhost/category/news</loc>')
    expect(xml).not.toContain('/category/empty')
    await setSeo(SITE, 'seo.noindex_taxonomies', true)
    xml = await (sitemapHandler as Handler)(ev()) as string
    expect(xml).not.toContain('/category/news')
    await clearSeo(SITE, 'seo.noindex_taxonomies')
  })
})

describe('llms.txt / llms-full.txt', () => {
  it('groups by content type, escapes Markdown, and includes the custom intro', async () => {
    await setSeo(SITE, 'seo.llms_intro', 'Start with the About page.')
    const txt = await (llmsHandler as Handler)(ev()) as string
    expect(txt).toContain('Start with the About page.')
    expect(txt).toContain('## Pages')
    expect(txt).toContain('## Posts')
    expect(txt).toContain('[First post](https://geo.localhost/first-post.md): Post \\[excerpt\\] \\*here\\*')
    expect(txt).toContain('https://geo.localhost/index.md')
    expect(txt).not.toContain('Hidden page')
    await clearSeo(SITE, 'seo.llms_intro')
  })

  it('links HTML URLs when Markdown alternates are off', async () => {
    await setSeo(SITE, 'seo.markdown_enabled', false)
    const txt = await (llmsHandler as Handler)(ev()) as string
    expect(txt).toContain('[First post](https://geo.localhost/first-post)')
    await clearSeo(SITE, 'seo.markdown_enabled')
  })

  it('404s when disabled or when every AI crawler is blocked', async () => {
    await setSeo(SITE, 'seo.llms_enabled', false)
    await expect((llmsHandler as Handler)(ev())).rejects.toMatchObject({ statusCode: 404 })
    await clearSeo(SITE, 'seo.llms_enabled')
    await setSeo(SITE, 'seo.ai_crawlers', 'disallow')
    await expect((llmsFullHandler as Handler)(ev())).rejects.toMatchObject({ statusCode: 404 })
    await clearSeo(SITE, 'seo.ai_crawlers')
  })

  it('llms-full.txt contains each page\'s full text as Markdown', async () => {
    const txt = await (llmsFullHandler as Handler)(ev()) as string
    expect(txt).toContain('# About us')
    expect(txt).toContain('ABOUT-BODY-TEXT')
    expect(txt).toContain('url: "https://geo.localhost/about"')
    expect(txt).not.toContain('Members page')
  })
})

describe('/indexnow-key.txt', () => {
  it('404s until IndexNow is on, then serves the key', async () => {
    await expect((indexnowKeyHandler as Handler)(ev())).rejects.toMatchObject({ statusCode: 404 })
    await setSeo(SITE, 'seo.indexnow_enabled', true)
    await setSeo(SITE, 'seo.indexnow_key', 'abcdef0123456789')
    expect(await (indexnowKeyHandler as Handler)(ev())).toBe('abcdef0123456789')
    await clearSeo(SITE, 'seo.indexnow_enabled')
    await clearSeo(SITE, 'seo.indexnow_key')
  })
})

describe('public page API', () => {
  it('resolves a multi-segment locale path to the translation, with its public path and alternates', async () => {
    const res = await (pageHandler as Handler)(ev({ params: { slug: 'es/about' } })) as {
      title: string; path: string; locale: string; alternates: { locale: string; path: string }[]
    }
    expect(res.title).toBe('Sobre nosotros')
    expect(res.path).toBe('/es/about')
    expect(res.alternates).toEqual(expect.arrayContaining([{ locale: 'en', path: '/about' }, { locale: 'es', path: '/es/about' }]))
  })

  it('returns the effective robots directive, including the content-type default', async () => {
    await setSeo(SITE, 'seo.noindex_content_types', ['event'])
    const res = await (pageHandler as Handler)(ev({ params: { slug: 'meetup' } })) as { robots: string | null; type: { slug: string }; event: { startAt: string } }
    expect(res.robots).toBe('noindex,follow')
    expect(res.type.slug).toBe('event')
    expect(res.event.startAt).toBe('2026-10-01T18:00:00.000Z')
    await clearSeo(SITE, 'seo.noindex_content_types')
  })

  it('throws 410 for a Gone redirect rule', async () => {
    await getCurrentTestDb().insert(redirects).values({ id: ulid(), siteId: SITE, from: '/removed', to: '', statusCode: 410 })
    clearRedirectCache(SITE)
    await expect((pageHandler as Handler)(ev({ params: { slug: 'removed' } }))).rejects.toMatchObject({ statusCode: 410 })
  })
})

describe('SEO response headers (05.seo-headers)', () => {
  it('sends Content-Signal on public pages and noindex on account/search screens', async () => {
    const page = ev({ path: '/about' })
    await (seoHeaders as Handler)(page)
    expect(headers(page)['Content-Signal']).toBe('search=yes, ai-input=yes, ai-train=yes')
    expect(headers(page)['X-Robots-Tag']).toBeUndefined()

    const search = ev({ path: '/search?q=x' })
    await (seoHeaders as Handler)(search)
    expect(headers(search)['X-Robots-Tag']).toBe('noindex, follow')

    const login = ev({ path: '/login' })
    await (seoHeaders as Handler)(login)
    expect(headers(login)['X-Robots-Tag']).toBe('noindex, nofollow')
  })

  it('noindexes every response when the site is hidden from search engines', async () => {
    await setSeo(SITE, 'seo.robots', 'noindex')
    const e = ev({ path: '/about' })
    await (seoHeaders as Handler)(e)
    expect(headers(e)['X-Robots-Tag']).toBe('noindex, nofollow')
    expect(headers(e)['Content-Signal']).toBe('search=no, ai-input=no, ai-train=no')
    await clearSeo(SITE, 'seo.robots')
  })

  it('noindexes duplicate hostnames, or 301s them to the canonical domain when enabled', async () => {
    const dup = ev({ path: '/about', headers: { host: 'geo.acct.workers.dev' } })
    await (seoHeaders as Handler)(dup)
    expect(headers(dup)['X-Robots-Tag']).toBe('noindex, nofollow')

    await setSeo(SITE, 'seo.redirect_to_primary', true)
    const redir = ev({ path: '/about?x=1', headers: { host: 'geo.acct.workers.dev' } })
    await (seoHeaders as Handler)(redir)
    expect(redirectOf(redir)).toEqual({ url: 'https://geo.localhost/about?x=1', code: 301 })

    // The admin is never redirected away (it's how operators recover from a bad domain).
    const admin = ev({ path: '/admin/settings', headers: { host: 'geo.acct.workers.dev' } })
    await (seoHeaders as Handler)(admin)
    expect(redirectOf(admin)).toBeUndefined()
    await clearSeo(SITE, 'seo.redirect_to_primary')
  })

  it('records a known crawler\'s visit in crawler_hits and the activity route reports it', async () => {
    const e = ev({ path: '/about', headers: { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)' } })
    await (seoHeaders as Handler)(e)
    const row = await waitFor(async () => (await getCurrentTestDb().query.crawlerHits.findFirst({
      where: and(eq(crawlerHits.siteId, SITE), eq(crawlerHits.bot, 'GPTBot')),
    })) ?? undefined)
    expect(row.hits).toBe(1)
    expect(row.category).toBe('ai-training')
    expect(row.lastPath).toBe('/about')

    // A second hit increments the same daily row.
    await (seoHeaders as Handler)(ev({ path: '/', headers: { 'user-agent': 'GPTBot/1.1' } }))
    await waitFor(async () => {
      const r = await getCurrentTestDb().query.crawlerHits.findFirst({ where: and(eq(crawlerHits.siteId, SITE), eq(crawlerHits.bot, 'GPTBot')) })
      return r && r.hits === 2 ? r : undefined
    })

    await setSeo(SITE, 'seo.ai_crawlers', 'block-training')
    const activity = await (crawlersHandler as Handler)(editorEv({ query: { days: '7' } })) as { bots: { bot: string; hits: number; blocked: boolean }[] }
    expect(activity.bots).toEqual([expect.objectContaining({ bot: 'GPTBot', hits: 2, blocked: true })])
    await clearSeo(SITE, 'seo.ai_crawlers')
  })
})

describe('Markdown alternates (06.markdown)', () => {
  it('serves /slug.md with a canonical Link header and the site Content-Signal', async () => {
    const e = ev({ path: '/about.md' })
    const md = await (markdownMiddleware as Handler)(e) as string
    expect(md).toContain('# About us')
    expect(md).toContain('ABOUT-BODY-TEXT')
    expect(headers(e)['Content-Type']).toBe('text/markdown; charset=utf-8')
    expect(headers(e).Link).toBe('<https://geo.localhost/about>; rel="canonical"')
    expect(headers(e)['Content-Signal']).toBe('search=yes, ai-input=yes, ai-train=yes')
  })

  it('serves translations and the homepage', async () => {
    expect(await (markdownMiddleware as Handler)(ev({ path: '/es/about.md' }))).toContain('CUERPO')
    expect(await (markdownMiddleware as Handler)(ev({ path: '/index.md' }))).toContain('# Home')
  })

  it('negotiates on Accept: text/markdown, and leaves browsers on HTML', async () => {
    const agent = ev({ path: '/about', headers: { accept: 'text/markdown, text/html;q=0.5' } })
    expect(await (markdownMiddleware as Handler)(agent)).toContain('ABOUT-BODY-TEXT')

    const browser = ev({ path: '/about', headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } })
    expect(await (markdownMiddleware as Handler)(browser)).toBeUndefined()
    expect(headers(browser).Vary).toEqual(['Accept'])
  })

  it('never exposes members-only content, and is off when disabled', async () => {
    const members = ev({ path: '/members.md' })
    expect(await (markdownMiddleware as Handler)(members)).toBe('Not found\n')
    expect(status(members)).toBe(404)

    await setSeo(SITE, 'seo.markdown_enabled', false)
    expect(await (markdownMiddleware as Handler)(ev({ path: '/about.md' }))).toBeUndefined()
    await clearSeo(SITE, 'seo.markdown_enabled')
  })
})

describe('redirect middleware', () => {
  beforeAll(async () => {
    await getCurrentTestDb().insert(redirects).values([
      { id: ulid(), siteId: SITE, from: '/old-page', to: '/new-page', statusCode: 301 },
      { id: ulid(), siteId: SITE, from: '/gone-page', to: '', statusCode: 410 },
    ])
    clearRedirectCache(SITE)
  })

  it('matches ignoring query string, trailing slash, and case — and forwards the query', async () => {
    const e = ev({ path: '/Old-Page/?utm_source=news' })
    await (redirectMiddleware as Handler)(e)
    expect(redirectOf(e)).toEqual({ url: '/new-page?utm_source=news', code: 301 })
  })

  it('answers 410 Gone for removed pages', async () => {
    const e = ev({ path: '/gone-page' })
    const body = await (redirectMiddleware as Handler)(e) as string
    expect(status(e)).toBe(410)
    expect(body).toContain('removed')
  })
})

describe('redirect APIs', () => {
  it('rejects a duplicate source path with 409', async () => {
    await (redirectCreate as Handler)(editorEv({ method: 'POST', body: { from: '/dup', to: '/a' } }))
    await expect((redirectCreate as Handler)(editorEv({ method: 'POST', body: { from: '/DUP/', to: '/b' } }))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('flattens chains: A→B then B→C leaves A pointing straight at C', async () => {
    await (redirectCreate as Handler)(editorEv({ method: 'POST', body: { from: '/chain-a', to: '/chain-b' } }))
    await (redirectCreate as Handler)(editorEv({ method: 'POST', body: { from: '/chain-b', to: '/chain-c' } }))
    const a = await getCurrentTestDb().query.redirects.findFirst({ where: and(eq(redirects.siteId, SITE), eq(redirects.from, '/chain-a')) })
    expect(a?.to).toBe('/chain-c')
  })

  it('edits a rule, including its source path', async () => {
    const { id } = await (redirectCreate as Handler)(editorEv({ method: 'POST', body: { from: '/edit-me', to: '/x' } })) as { id: string }
    const res = await (redirectPatch as Handler)(editorEv({ method: 'PATCH', params: { id }, body: { from: '/edited', to: '/y', statusCode: 308 } })) as { from: string; to: string; statusCode: number }
    expect(res).toMatchObject({ from: '/edited', to: '/y', statusCode: 308 })
    const old = await getCurrentTestDb().query.redirects.findFirst({ where: and(eq(redirects.siteId, SITE), eq(redirects.from, '/edit-me')) })
    expect(old).toBeUndefined()
  })

  it('imports CSV, reporting bad lines without failing the rest', async () => {
    const res = await (redirectImport as Handler)(editorEv({
      method: 'POST',
      body: { csv: 'from,to,status\n/imp-1,/one\n/imp-2,https://x.test/two,302\nnot-a-path,/x\n/imp-3,,410\n/dup,/overwritten' },
    })) as { created: number; updated: number; skipped: number; errors: { line: number }[] }
    expect(res.created).toBe(3)
    expect(res.skipped).toBe(1) // /dup exists and overwrite is off
    expect(res.errors.map(e => e.line)).toEqual([4])
  })
})

describe('slug change → automatic redirect', () => {
  it('301s the old URL (and its translations\' URLs) to the new one when a published page is renamed', async () => {
    const db = getCurrentTestDb()
    const id = await seedContentItem(db, SITE, pageType, { slug: 'services', title: 'Services', locale: 'en' })
    await seedContentItem(db, SITE, pageType, { slug: 'services-fr', title: 'Services FR', locale: 'fr', sourceItemId: id })

    await (contentPatch as Handler)(adminEv({ method: 'PATCH', params: { id }, body: { slug: 'what-we-do' } }))

    const rows = await db.query.redirects.findMany({ where: eq(redirects.siteId, SITE) })
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '/services', to: '/what-we-do', statusCode: 301 }),
      expect.objectContaining({ from: '/fr/services', to: '/fr/what-we-do', statusCode: 301 }),
    ]))
  })

  it('does not add redirects for drafts', async () => {
    const db = getCurrentTestDb()
    const id = await seedContentItem(db, SITE, pageType, { slug: 'draft-x', title: 'Draft', status: 'draft' })
    await (contentPatch as Handler)(adminEv({ method: 'PATCH', params: { id }, body: { slug: 'draft-y' } }))
    const row = await db.query.redirects.findFirst({ where: and(eq(redirects.siteId, SITE), eq(redirects.from, '/draft-x')) })
    expect(row).toBeUndefined()
  })
})

describe('IndexNow', () => {
  it('skips when disabled', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const res = await submitToIndexNow(getCurrentTestDb(), SITE, ['/about'])
    expect(res.skipped).toBe('disabled')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts host, key, keyLocation, and absolute URLs — and throttles repeat submissions', async () => {
    await setSeo(SITE, 'seo.indexnow_enabled', true)
    await setSeo(SITE, 'seo.indexnow_key', 'feedface12345678')
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchSpy)

    const first = await submitToIndexNow(getCurrentTestDb(), SITE, ['/indexnow-a', '/indexnow-b'])
    expect(first.status).toBe(202)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://api.indexnow.org/indexnow')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      host: 'geo.localhost',
      key: 'feedface12345678',
      keyLocation: 'https://geo.localhost/indexnow-key.txt',
      urlList: ['https://geo.localhost/indexnow-a', 'https://geo.localhost/indexnow-b'],
    })

    const second = await submitToIndexNow(getCurrentTestDb(), SITE, ['/indexnow-a'])
    expect(second.skipped).toBe('nothing-new')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await clearSeo(SITE, 'seo.indexnow_enabled')
    await clearSeo(SITE, 'seo.indexnow_key')
  })
})

describe('SEO settings save', () => {
  it('normalizes values, rejects bad ones, and generates an IndexNow key on first enable', async () => {
    await (settingsPatch as Handler)(adminEv({
      method: 'PATCH',
      body: { settings: { 'seo.canonical_url': 'https://geo.localhost/', 'seo.indexnow_enabled': true, 'seo.verify_google': '<meta name="google-site-verification" content="G-123" />' } },
    }))
    const rows = await getCurrentTestDb().query.siteSettings.findMany({ where: eq(siteSettings.siteId, SITE) })
    const kv = Object.fromEntries(rows.map(r => [r.key, r.value]))
    expect(kv['seo.canonical_url']).toBe('https://geo.localhost')
    expect(kv['seo.verify_google']).toBe('G-123')
    expect(kv['seo.indexnow_key']).toMatch(/^[0-9a-f]{32}$/)

    await expect((settingsPatch as Handler)(adminEv({ method: 'PATCH', body: { settings: { 'seo.ai_crawlers': 'sometimes' } } })))
      .rejects.toMatchObject({ statusCode: 422 })

    for (const k of ['seo.canonical_url', 'seo.indexnow_enabled', 'seo.verify_google', 'seo.indexnow_key']) await clearSeo(SITE, k)
  })
})

describe('SEO audit route', () => {
  it('flags pages without descriptions and reports site-level gaps', async () => {
    const res = await (auditHandler as Handler)(editorEv()) as {
      summary: { total: number }
      site: { id: string; severity: string }[]
      items: { path: string; issues: { code: string }[] }[]
    }
    const post = res.items.find(i => i.path === '/first-post')
    expect(post?.issues.map(i => i.code)).toContain('no_custom_description')
    const hidden = res.items.find(i => i.path === '/hidden')
    expect(hidden?.issues.map(i => i.code)).toEqual(['noindex'])
    expect(res.items.find(i => i.path === '/es/about')).toBeDefined()
    expect(res.site.find(s => s.id === 'description')?.severity).toBe('warning')
  })

  it('requires at least editor', async () => {
    const db = getCurrentTestDb()
    const authorId = await seedUser(db, { name: 'Author', email: 'author@geo.test' })
    await seedRole(db, authorId, SITE, 'author')
    await expect((auditHandler as Handler)(ev({ session: { user: { id: authorId, name: 'Author', email: 'author@geo.test' } } })))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})
