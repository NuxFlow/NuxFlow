import { useDb } from '../utils/db'
import { contentItems, sites } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { domain: true },
  })

  const baseUrl = site ? `https://${site.domain}` : config.public.siteUrl

  const pages = await db.query.contentItems.findMany({
    where: and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published')),
    columns: { slug: true, updatedAt: true },
  })

  const urls = pages.map(p => `
  <url>
    <loc>${baseUrl}/${p.slug}</loc>
    <lastmod>${p.updatedAt}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('')

  setHeader(event, 'Content-Type', 'application/xml')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>${urls}
</urlset>`
})
