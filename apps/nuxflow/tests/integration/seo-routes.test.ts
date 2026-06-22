import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedContentType, seedContentItem, seedSetting } from '../helpers/seed'
import robotsHandler from '../../server/routes/robots.txt'
import sitemapHandler from '../../server/routes/sitemap.xml'
import feedHandler from '../../server/routes/feed.xml'
import atomHandler from '../../server/routes/atom.xml'
import llmsHandler from '../../server/routes/llms.txt'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-seo-routes-01'
let authorId: string
let typeId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'seo.localhost', name: 'SEO Test Site' })
  typeId = await seedContentType(db, SITE, { slug: 'post', name: 'Post', singularName: 'Post' })
  authorId = await seedUser(db, { name: 'Jane Author', email: 'jane@seo.test' })

  // Public post with OG image and named author
  await seedContentItem(db, SITE, typeId, {
    slug: 'hello-world',
    title: 'Hello World',
    status: 'published',
    visibility: 'public',
    ogImage: 'https://example.com/og.jpg',
    excerpt: 'My first post excerpt',
    authorId,
    publishedAt: new Date(Date.now() - 60_000).toISOString(),
  })

  // Public post without image or author
  await seedContentItem(db, SITE, typeId, {
    slug: 'no-image-post',
    title: 'No Image Post',
    status: 'published',
    visibility: 'public',
    publishedAt: new Date(Date.now() - 120_000).toISOString(),
  })

  // Draft — must be excluded from all feeds and sitemap
  await seedContentItem(db, SITE, typeId, {
    slug: 'draft-post',
    title: 'Draft Post',
    status: 'draft',
    visibility: 'public',
  })

  // Members-only — must be excluded from all public feeds and sitemap
  await seedContentItem(db, SITE, typeId, {
    slug: 'members-post',
    title: 'Members Post',
    status: 'published',
    visibility: 'members',
  })

  await seedSetting(db, SITE, 'seo.description', 'A great test site for SEO testing')
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent() {
  return createMockEvent({ siteId: SITE }) as unknown as H3Event
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

describe('GET /robots.txt', () => {
  it('includes standard crawler rules by default', async () => {
    const result = await (robotsHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('User-agent: *')
    expect(result).toContain('Allow: /')
    expect(result).toContain('Disallow: /admin')
    expect(result).toContain('Disallow: /api')
  })

  it('includes sitemap link pointing to site domain', async () => {
    const result = await (robotsHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('Sitemap: https://seo.localhost/sitemap.xml')
  })

  it('allows AI crawlers by default (no per-bot rules)', async () => {
    const result = await (robotsHandler as HandlerFn)(mkEvent()) as string
    expect(result).not.toContain('User-agent: GPTBot')
    expect(result).not.toContain('User-agent: ClaudeBot')
    expect(result).not.toContain('User-agent: PerplexityBot')
  })

  it('disallows everything when seo.robots is noindex', async () => {
    const db = getCurrentTestDb()
    const noindexSite = 'site-seo-noindex'
    await seedSite(db, { id: noindexSite, domain: 'noindex.localhost' })
    await seedSetting(db, noindexSite, 'seo.robots', 'noindex')
    const event = createMockEvent({ siteId: noindexSite }) as unknown as H3Event
    const result = await (robotsHandler as HandlerFn)(event) as string
    expect(result).toBe('User-agent: *\nDisallow: /\n')
  })

  it('adds per-bot Disallow blocks when seo.ai_crawlers is disallow', async () => {
    const db = getCurrentTestDb()
    const aiBlockSite = 'site-seo-ai-block'
    await seedSite(db, { id: aiBlockSite, domain: 'aiblock.localhost' })
    await seedSetting(db, aiBlockSite, 'seo.ai_crawlers', 'disallow')
    const event = createMockEvent({ siteId: aiBlockSite }) as unknown as H3Event
    const result = await (robotsHandler as HandlerFn)(event) as string
    expect(result).toContain('User-agent: GPTBot')
    expect(result).toContain('User-agent: ClaudeBot')
    expect(result).toContain('User-agent: PerplexityBot')
    expect(result).toContain('User-agent: ChatGPT-User')
    expect(result).toContain('User-agent: anthropic-ai')
    // Global allow must still appear for regular crawlers
    expect(result).toContain('User-agent: *')
    expect(result).toContain('Allow: /')
  })

  it('prefers canonical URL over site domain in sitemap link', async () => {
    const db = getCurrentTestDb()
    const canonSite = 'site-seo-canon'
    await seedSite(db, { id: canonSite, domain: 'canon.localhost' })
    await seedSetting(db, canonSite, 'seo.canonical_url', 'https://www.mysite.com')
    const event = createMockEvent({ siteId: canonSite }) as unknown as H3Event
    const result = await (robotsHandler as HandlerFn)(event) as string
    expect(result).toContain('Sitemap: https://www.mysite.com/sitemap.xml')
    expect(result).not.toContain('canon.localhost')
  })
})

// ---------------------------------------------------------------------------
// sitemap.xml
// ---------------------------------------------------------------------------

describe('GET /sitemap.xml', () => {
  it('declares the image namespace', async () => {
    const result = await (sitemapHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')
  })

  it('includes homepage, blog index, and search', async () => {
    const result = await (sitemapHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('<loc>https://seo.localhost/</loc>')
    expect(result).toContain('<loc>https://seo.localhost/blog</loc>')
    expect(result).toContain('<loc>https://seo.localhost/search</loc>')
  })

  it('includes published public content items', async () => {
    const result = await (sitemapHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('https://seo.localhost/hello-world')
    expect(result).toContain('https://seo.localhost/no-image-post')
  })

  it('excludes draft content', async () => {
    const result = await (sitemapHandler as HandlerFn)(mkEvent()) as string
    expect(result).not.toContain('/draft-post')
  })

  it('excludes members-only content', async () => {
    const result = await (sitemapHandler as HandlerFn)(mkEvent()) as string
    expect(result).not.toContain('/members-post')
  })

  it('includes image:image tag for posts with ogImage', async () => {
    const result = await (sitemapHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('<image:image>')
    expect(result).toContain('<image:loc>https://example.com/og.jpg</image:loc>')
  })

  it('does not include image:image for posts without ogImage', async () => {
    const result = await (sitemapHandler as HandlerFn)(mkEvent()) as string
    // Only the post with ogImage generates an image:image tag
    const imageTagCount = (result.match(/<image:image>/g) ?? []).length
    expect(imageTagCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// feed.xml
// ---------------------------------------------------------------------------

describe('GET /feed.xml', () => {
  it('is valid RSS 2.0 with required namespaces', async () => {
    const result = await (feedHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('version="2.0"')
    expect(result).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"')
    expect(result).toContain('xmlns:media="http://search.yahoo.com/mrss/"')
    expect(result).toContain('xmlns:atom="http://www.w3.org/2005/Atom"')
  })

  it('includes published public posts', async () => {
    const result = await (feedHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('Hello World')
    expect(result).toContain('https://seo.localhost/hello-world')
  })

  it('excludes draft posts', async () => {
    const result = await (feedHandler as HandlerFn)(mkEvent()) as string
    expect(result).not.toContain('Draft Post')
  })

  it('excludes members-only posts', async () => {
    const result = await (feedHandler as HandlerFn)(mkEvent()) as string
    expect(result).not.toContain('Members Post')
  })

  it('includes author element for posts with a named author', async () => {
    const result = await (feedHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('<author>Jane Author</author>')
  })

  it('includes media:thumbnail and media:content for posts with ogImage', async () => {
    const result = await (feedHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('<media:thumbnail url="https://example.com/og.jpg"')
    expect(result).toContain('<media:content url="https://example.com/og.jpg" medium="image"')
  })

  it('includes excerpt as description', async () => {
    const result = await (feedHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('My first post excerpt')
  })

  it('includes Atom alternate link pointing to atom.xml', async () => {
    const result = await (feedHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('rel="alternate" type="application/atom+xml"')
    expect(result).toContain('/atom.xml')
  })
})

// ---------------------------------------------------------------------------
// atom.xml
// ---------------------------------------------------------------------------

describe('GET /atom.xml', () => {
  it('is valid Atom 1.0', async () => {
    const result = await (atomHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('<?xml version="1.0"')
    expect(result).toContain('<feed xmlns="http://www.w3.org/2005/Atom"')
    expect(result).toContain('</feed>')
  })

  it('includes feed-level title and link', async () => {
    const result = await (atomHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('<title>SEO Test Site</title>')
    expect(result).toContain('<link href="https://seo.localhost"')
    expect(result).toContain('rel="self"')
  })

  it('includes entry elements for published public posts', async () => {
    const result = await (atomHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('<entry>')
    expect(result).toContain('Hello World')
    expect(result).toContain('https://seo.localhost/hello-world')
  })

  it('includes ISO 8601 updated and published dates in entries', async () => {
    const result = await (atomHandler as HandlerFn)(mkEvent()) as string
    // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(result).toMatch(/<published>\d{4}-\d{2}-\d{2}T/)
    expect(result).toMatch(/<updated>\d{4}-\d{2}-\d{2}T/)
  })

  it('includes author element for entries with a named author', async () => {
    const result = await (atomHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('<author><name>Jane Author</name></author>')
  })

  it('excludes draft and members-only posts', async () => {
    const result = await (atomHandler as HandlerFn)(mkEvent()) as string
    expect(result).not.toContain('Draft Post')
    expect(result).not.toContain('Members Post')
  })
})

// ---------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------

describe('GET /llms.txt', () => {
  it('starts with the site name as an h1 heading', async () => {
    const result = await (llmsHandler as HandlerFn)(mkEvent()) as string
    expect(result.trim()).toMatch(/^# SEO Test Site/)
  })

  it('includes the site description as a blockquote', async () => {
    const result = await (llmsHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('> A great test site for SEO testing')
  })

  it('lists published public content with markdown links', async () => {
    const result = await (llmsHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('[Hello World](https://seo.localhost/hello-world)')
    expect(result).toContain('[No Image Post](https://seo.localhost/no-image-post)')
  })

  it('excludes draft content from the listing', async () => {
    const result = await (llmsHandler as HandlerFn)(mkEvent()) as string
    expect(result).not.toContain('Draft Post')
  })

  it('excludes members-only content from the listing', async () => {
    const result = await (llmsHandler as HandlerFn)(mkEvent()) as string
    expect(result).not.toContain('Members Post')
  })

  it('includes excerpt inline after the link', async () => {
    const result = await (llmsHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('My first post excerpt')
  })

  it('has a Content Discovery section with sitemap, feeds, and search', async () => {
    const result = await (llmsHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('/sitemap.xml')
    expect(result).toContain('/feed.xml')
    expect(result).toContain('/atom.xml')
    expect(result).toContain('/search')
  })

  it('has a Content API section pointing to the public posts endpoint', async () => {
    const result = await (llmsHandler as HandlerFn)(mkEvent()) as string
    expect(result).toContain('/api/public/posts')
  })
})
