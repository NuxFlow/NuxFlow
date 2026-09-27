import { users } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { useReplicaDb } from '../utils/db'
import { markdownCachePath, withEdgeCacheKey } from '../utils/edge-cache'
import { pageToMarkdown } from '../utils/markdown'
import { findPublishedPage, itemPublicPath, parseLocalePath } from '../utils/public-page'
import { contentSignal, getSeoSettings, isNoindexPath, robotsSaysNoindex, siteBaseUrl, toIsoDateTime } from '../utils/seo'

// Markdown alternates of public pages, for AI agents and LLM tooling — roughly 80% fewer
// tokens than the rendered HTML, with none of the layout chrome:
//   - `GET /about.md` (and `/index.md` for the homepage, `/es/about.md` for a translation)
//   - `GET /about` with `Accept: text/markdown` preferred over text/html (the same content
//     negotiation Cloudflare's Markdown for Agents uses, so agents built for that work here
//     on any zone/plan)
// Pages advertise it with <link rel="alternate" type="text/markdown"> (ContentPage.vue)
// and llms.txt links to it. Only published, public items; turned off per site in
// Admin → SEO (and whenever every AI crawler is blocked). Runs before 07.page-cache.ts so
// a Markdown request never reads or writes the HTML page cache — its own edge-cache entry
// lives under a separate key (markdownCachePath).
const EXCLUDED_PREFIXES = ['/api', '/admin', '/_', '/setup', '/blog']

function prefersMarkdown(accept: string | undefined): boolean {
  if (!accept || !accept.includes('text/markdown')) return false
  let md = 0
  let html = 0
  for (const part of accept.split(',')) {
    const [type = '', ...params] = part.trim().split(';')
    const qParam = params.map(p => p.trim()).find(p => p.startsWith('q='))
    const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1
    const t = type.trim().toLowerCase()
    if (t === 'text/markdown') md = Math.max(md, Number.isFinite(q) ? q : 0)
    else if (t === 'text/html') html = Math.max(html, Number.isFinite(q) ? q : 0)
  }
  return md > 0 && md >= html
}

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) return
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const url = getRequestURL(event)
  const path = url.pathname
  if (EXCLUDED_PREFIXES.some(p => path === p || path.startsWith(`${p}/`)) || isNoindexPath(path)) return

  let pagePath: string
  const explicit = path.endsWith('.md')
  if (explicit) {
    pagePath = path === '/index.md' ? '/' : path.slice(0, -3)
  } else {
    // Only extension-less page paths negotiate (not /robots.txt, /feed.xml, ...).
    const last = path.split('/').pop() ?? ''
    if (last.includes('.')) return
    pagePath = path.length > 1 ? path.replace(/\/+$/, '') : '/'
  }

  const db = useReplicaDb(event)
  const seo = await getSeoSettings(db, siteId)
  const enabled = seo.markdownEnabled && seo.aiCrawlers !== 'disallow'
  if (!explicit) {
    if (enabled) appendResponseHeader(event, 'Vary', 'Accept')
    if (!enabled || !prefersMarkdown(getHeader(event, 'accept'))) return
  }
  if (!enabled) return

  const notFoundResponse = () => {
    setResponseStatus(event, 404)
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return 'Not found\n'
  }

  const slugPath = pagePath === '/' ? 'home' : pagePath.slice(1)
  const { locale, slug } = await parseLocalePath(db, siteId, slugPath)
  const page = await findPublishedPage(db, siteId, slug, locale)
  // Gated/private content never has a public Markdown form. For a negotiated request,
  // fall through so the HTML route answers exactly as it would for a browser (402/404).
  if (!page || page.visibility !== 'public') return explicit ? notFoundResponse() : undefined

  const site = event.context.siteDomain as string | null
  const base = siteBaseUrl(seo, site, url.origin)
  const htmlPath = await itemPublicPath(db, siteId, page)
  const htmlUrl = `${base}${htmlPath}`

  const markdown = await withEdgeCacheKey(event, `${url.origin}${markdownCachePath(pagePath)}`, 3600, async () => {
    const author = page.authorId
      ? await db.query.users.findFirst({ where: eq(users.id, page.authorId), columns: { name: true } })
      : null
    return pageToMarkdown({
      title: page.seoTitle || page.title,
      url: htmlUrl,
      description: page.seoDescription || page.excerpt,
      author: author?.name,
      locale: page.locale,
      publishedAt: toIsoDateTime(page.publishedAt),
      updatedAt: toIsoDateTime(page.updatedAt),
    }, page.content)
  })

  setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  setHeader(event, 'Content-Signal', contentSignal(seo))
  // The HTML page is the canonical document; this is an alternate representation.
  setHeader(event, 'Link', `<${htmlUrl}>; rel="canonical"`)
  // Same token estimate header Cloudflare's Markdown for Agents sends (≈4 chars/token).
  setHeader(event, 'X-Markdown-Tokens', String(Math.ceil(markdown.length / 4)))
  if (seo.noindex || robotsSaysNoindex(page.metaRobots)) setHeader(event, 'X-Robots-Tag', 'noindex')
  return markdown
})
