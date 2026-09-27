import type { H3Event } from 'h3'
import { useDb } from '../utils/db'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { blockedCrawlerTokens, contentSignal, getSeoSettings, NOINDEX_PATHS, siteBaseUrl } from '../utils/seo'

/**
 * Builds a site's robots.txt from its SEO settings (Admin → SEO):
 *
 * - The `*` group allows the public site and disallows account/admin/API/internal-search
 *   paths, and carries a Content-Signal line (contentsignals.org — the same directive
 *   Cloudflare's managed robots.txt uses) stating the site's search / AI-input / AI-train
 *   preferences for crawlers that honor it.
 * - Per-crawler `Disallow: /` groups for whichever AI crawlers the site blocks (training
 *   only, or all of them — see AiCrawlerMode in utils/seo.ts).
 * - "Hide from search engines" (noindex) deliberately does NOT write `Disallow: /`: a
 *   crawler that may not fetch a page never sees its noindex, so an already-linked URL
 *   can stay in results as a bare link. The site-wide X-Robots-Tag header
 *   (05.seo-headers.ts) does the de-indexing; robots.txt only states the signal.
 * - Admin-authored custom rules are appended verbatim.
 *
 * If the zone has Cloudflare's "managed robots.txt" enabled, Cloudflare prepends its own
 * block above this one — see the note on the AI Crawlers tab.
 */
async function buildRobotsTxt(event: H3Event, siteId: string): Promise<string> {
  const db = useDb(event)
  const [seo, site] = await Promise.all([
    getSeoSettings(db, siteId),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
  ])
  const baseUrl = siteBaseUrl(seo, site?.domain, useRuntimeConfig().public.siteUrl as string)

  const lines: string[] = [
    `# robots.txt for ${baseUrl}`,
    '',
    'User-agent: *',
    `Content-Signal: ${contentSignal(seo)}`,
    'Allow: /',
    'Disallow: /api/',
    ...NOINDEX_PATHS.flatMap(p => [`Disallow: ${p}$`, `Disallow: ${p}/`]),
    'Disallow: /*?__theme_id=',
  ]

  const blocked = blockedCrawlerTokens(seo.aiCrawlers)
  if (blocked.length > 0) {
    lines.push('', seo.aiCrawlers === 'block-training'
      ? '# AI model-training crawlers (AI search and answer crawlers remain allowed)'
      : '# AI crawlers')
    for (const token of blocked) lines.push(`User-agent: ${token}`)
    lines.push('Disallow: /')
  }

  if (seo.robotsCustom) {
    lines.push('', '# Custom rules', seo.robotsCustom)
  }

  lines.push('', `Sitemap: ${baseUrl}/sitemap.xml`, `Sitemap: ${baseUrl}/sitemap-images.xml`, '')
  return lines.join('\n')
}

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string

  setHeader(event, 'Content-Type', 'text/plain; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  // Fetched extremely frequently by bots and almost never changes. Purged on every
  // settings save (purgeAllPublicPages in edge-cache.ts), so the TTL only bounds other colos.
  return withEdgeCache(event, 3600, () => buildRobotsTxt(event, siteId))
})
