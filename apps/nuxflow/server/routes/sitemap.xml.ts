import type { H3Event } from 'h3'
import { useDb } from '../utils/db'
import { contentItems, sites, siteSettings, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/xml')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildSitemap(event))
})

async function buildSitemap(event: H3Event) {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  const [site, canonicalSetting] = await Promise.all([
    db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { domain: true },
    }),
    db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, 'seo.canonical_url')),
      columns: { value: true },
    }),
  ])

  const domainBase = site ? `https://${site.domain}` : config.public.siteUrl
  const baseUrl = (canonicalSetting?.value as string | undefined)?.trim() || domainBase

  // The sitemap protocol caps a single file at 50,000 URLs. This route only ever emits
  // one file (no sitemap-index pagination), so without a bound, an increasingly large
  // catalog would eventually produce a spec-violating file and re-run this same unbounded
  // scan on every cache-miss. Capped well under the real limit — a site that reaches it
  // needs true sitemap-index pagination, which this intentionally doesn't attempt; the
  // warning below is the signal that it's needed.
  const SITEMAP_URL_CAP = 45_000

  const [pages, taxRows] = await Promise.all([
    db.query.contentItems.findMany({
      // Only public visibility — gated/private pages must not be indexed
      where: and(
        eq(contentItems.siteId, siteId),
        eq(contentItems.status, 'published'),
        eq(contentItems.visibility, 'public'),
      ),
      columns: { slug: true, updatedAt: true, ogImage: true },
      limit: SITEMAP_URL_CAP,
    }),
    db
      .select({ taxSlug: taxonomies.slug, termSlug: taxonomyTerms.slug })
      .from(taxonomyTerms)
      .innerJoin(taxonomies, eq(taxonomies.id, taxonomyTerms.taxonomyId))
      .where(eq(taxonomies.siteId, siteId))
      .limit(SITEMAP_URL_CAP),
  ])

  if (pages.length >= SITEMAP_URL_CAP || taxRows.length >= SITEMAP_URL_CAP) {
    console.warn(`[sitemap.xml] Truncated at ${SITEMAP_URL_CAP} URLs for site ${siteId} — this site needs paginated sitemap-index support.`)
  }

  const contentUrls = pages.map(p => `
  <url>
    <loc>${baseUrl}/${escXml(p.slug)}</loc>
    <lastmod>${p.updatedAt}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    ${p.ogImage ? `<image:image><image:loc>${escXml(p.ogImage)}</image:loc></image:image>` : ''}
  </url>`).join('')

  const taxUrls = taxRows.map(t => `
  <url>
    <loc>${baseUrl}/${escXml(t.taxSlug)}/${escXml(t.termSlug)}</loc>
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/blog</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseUrl}/search</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>${contentUrls}${taxUrls}
</urlset>`
}
