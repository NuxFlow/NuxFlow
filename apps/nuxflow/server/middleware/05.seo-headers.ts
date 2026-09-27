import { useDb } from '../utils/db'
import { contentSignal, detectCrawler, getSeoSettings, isNoindexPath, siteBaseUrl } from '../utils/seo'
import { recordCrawlerHit } from '../utils/crawler-tracking'

// Response-level SEO/GEO signals that must apply to every public response — including
// full-page-cache hits (07.page-cache.ts sets its headers on this same event, so anything
// set here survives a HIT) and non-HTML files like robots.txt, sitemaps, and llms.txt:
//
// - `X-Robots-Tag: noindex` for the site-wide "hide from search engines" setting, for
//   account/admin/search screens, and for any hostname that isn't the site's primary one
//   (the *.workers.dev address, a www/apex twin, a domain mid-migration). A header rather
//   than only a <meta> tag because it also covers non-HTML responses, and because it's the
//   only form that works for a cached page whose HTML was rendered before the change.
// - `Content-Signal` (contentsignals.org) mirroring the site's AI-crawler choice — see
//   contentSignal() in utils/seo.ts for why Cloudflare's Markdown for Agents needs it.
// - Optional 301 from a non-primary hostname to the canonical one (opt-in per site —
//   off by default because a zone-level Cloudflare redirect in the opposite direction,
//   e.g. apex → www, would otherwise loop).
// - Crawler activity counting (utils/crawler-tracking.ts).
//
// Runs after 02.multi-site.ts (needs siteId/siteDomain) and 05.redirects.ts, before the
// page cache.
const SKIP_PREFIXES = ['/_nuxt/', '/_nuxflow/', '/api/', '/__nuxt']
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) return
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const url = getRequestURL(event)
  const path = url.pathname
  if (SKIP_PREFIXES.some(p => path.startsWith(p))) return

  let seo
  try {
    seo = await getSeoSettings(useDb(event), siteId)
  } catch (err) {
    // A settings read failure must never take a public page down.
    console.error('[seo-headers] Failed to load SEO settings', err)
    return
  }

  const host = (getHeader(event, 'host') ?? '').split(':')[0]!.toLowerCase()
  const siteDomain = (event.context.siteDomain as string | null | undefined)?.toLowerCase() ?? ''
  const base = siteBaseUrl(seo, siteDomain)
  let canonicalHost = ''
  try {
    canonicalHost = base ? new URL(base).hostname.toLowerCase() : ''
  } catch { /* unparsable — treat as unknown */ }
  const isPrimaryHost = LOCAL_HOSTS.has(host) || host === siteDomain || host === canonicalHost

  const isAdminOrSetup = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/setup')
  if (!isPrimaryHost && seo.redirectToPrimary && base && !isAdminOrSetup) {
    return sendRedirect(event, `${base}${path}${url.search}`, 301)
  }

  if (seo.noindex || !isPrimaryHost) {
    setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  } else if (isNoindexPath(path)) {
    setHeader(event, 'X-Robots-Tag', path === '/search' ? 'noindex, follow' : 'noindex, nofollow')
  }

  if (!isAdminOrSetup) {
    setHeader(event, 'Content-Signal', contentSignal(seo))
  }

  if (!isAdminOrSetup) {
    const crawler = detectCrawler(getHeader(event, 'user-agent'))
    if (crawler) recordCrawlerHit(event, siteId, crawler, path)
  }
})
