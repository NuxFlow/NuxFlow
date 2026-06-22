import { useDb } from '../utils/db'
import { contentItems, sites, siteSettings, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default defineEventHandler(async (event) => {
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

  const [pages, taxRows] = await Promise.all([
    db.query.contentItems.findMany({
      // Only public visibility — gated/private pages must not be indexed
      where: and(
        eq(contentItems.siteId, siteId),
        eq(contentItems.status, 'published'),
        eq(contentItems.visibility, 'public'),
      ),
      columns: { slug: true, updatedAt: true, ogImage: true },
    }),
    db
      .select({ taxSlug: taxonomies.slug, termSlug: taxonomyTerms.slug })
      .from(taxonomyTerms)
      .innerJoin(taxonomies, eq(taxonomyTerms.taxonomyId, taxonomies.id))
      .where(eq(taxonomies.siteId, siteId)),
  ])

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

  setHeader(event, 'Content-Type', 'application/xml')
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
})
