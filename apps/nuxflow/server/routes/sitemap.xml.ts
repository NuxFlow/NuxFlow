import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { escXml } from '../utils/xml'
import { absoluteUrl } from '../utils/media-url'
import { getSeoSettings, siteBaseUrl, toIsoDateTime } from '../utils/seo'
import { alternateGroups, getIndexableEntries, getTaxonomyArchiveEntries } from '../utils/sitemap-entries'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildSitemap(event))
})

// The sitemap protocol caps a single file at 50,000 URLs. This route only ever emits one
// file (no sitemap-index pagination), so it's capped well under that — a site that
// reaches it needs sitemap-index support, which the warning below flags.
const SITEMAP_URL_CAP = 45_000

async function buildSitemap(event: H3Event) {
  // Anonymous, read-only, edge-cached — safe to read from a D1 read replica when one is
  // enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string

  const [site, seo] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
    getSeoSettings(db, siteId),
  ])
  const rawBaseUrl = siteBaseUrl(seo, site?.domain, useRuntimeConfig().public.siteUrl as string)
  const loc = (path: string) => escXml(`${rawBaseUrl}${path}`)

  const [{ entries, truncated }, taxonomyEntries] = await Promise.all([
    getIndexableEntries(db, siteId, seo, SITEMAP_URL_CAP),
    seo.noindexTaxonomies ? Promise.resolve([]) : getTaxonomyArchiveEntries(db, siteId, SITEMAP_URL_CAP),
  ])
  if (truncated) {
    console.warn(`[sitemap.xml] Truncated at ${SITEMAP_URL_CAP} URLs for site ${siteId} — this site needs paginated sitemap-index support.`)
  }

  // hreflang alternates: every member of a translation group lists every other member
  // (and itself), plus x-default pointing at the original.
  const groups = alternateGroups(entries)
  const alternatesFor = (entryId: string, sourceItemId: string | null) => {
    const group = groups.get(sourceItemId ?? entryId)
    if (!group) return ''
    const original = group.find(g => !g.sourceItemId) ?? group[0]!
    return [
      ...group.map(g => `\n    <xhtml:link rel="alternate" hreflang="${escXml(g.locale)}" href="${loc(g.path)}"/>`),
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${loc(original.path)}"/>`,
    ].join('')
  }

  const urls: string[] = []
  const seen = new Set<string>()
  const addUrl = (path: string, lastmod: string | null | undefined, extra = '') => {
    if (seen.has(path)) return
    seen.add(path)
    const iso = toIsoDateTime(lastmod)
    urls.push(`  <url>\n    <loc>${loc(path)}</loc>${iso ? `\n    <lastmod>${iso}</lastmod>` : ''}${extra}\n  </url>`)
  }

  const home = entries.find(e => e.path === '/')
  const posts = entries.filter(e => e.typeSlug === 'post')
  addUrl('/', home?.updatedAt, home ? alternatesFor(home.id, home.sourceItemId) : '')
  if (posts.length > 0) addUrl('/blog', posts.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), posts[0]!.updatedAt))

  for (const e of entries) {
    const image = e.ogImage && !e.ogImage.startsWith('data:')
      ? `\n    <image:image><image:loc>${escXml(absoluteUrl(e.ogImage, rawBaseUrl))}</image:loc></image:image>`
      : ''
    addUrl(e.path, e.updatedAt, `${alternatesFor(e.id, e.sourceItemId)}${image}`)
  }
  for (const t of taxonomyEntries) addUrl(t.path, t.lastmod)

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`
}
