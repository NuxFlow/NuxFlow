import { useDb } from '../utils/db'
import { media, sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq, like } from 'drizzle-orm'

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  const [site, canonicalSetting, images] = await Promise.all([
    db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { domain: true },
    }),
    db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, 'seo.canonical_url')),
      columns: { value: true },
    }),
    db.select({
      url: media.url,
      altText: media.altText,
      caption: media.caption,
    }).from(media).where(
      and(
        eq(media.siteId, siteId),
        like(media.mimeType, 'image/%'),
      ),
    ),
  ])

  const domainBase = site ? `https://${site.domain}` : config.public.siteUrl
  const baseUrl = (canonicalSetting?.value as string | undefined)?.trim() || domainBase

  const imageEntries = images
    .filter(img => img.url)
    .map(img => {
      const lines: string[] = [`    <image:loc>${escXml(img.url)}</image:loc>`]
      if (img.altText) lines.push(`    <image:title>${escXml(img.altText)}</image:title>`)
      if (img.caption) lines.push(`    <image:caption>${escXml(img.caption)}</image:caption>`)
      return `  <image:image>\n${lines.join('\n')}\n  </image:image>`
    })
    .join('\n')

  setHeader(event, 'Content-Type', 'application/xml')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${baseUrl}/</loc>
${imageEntries}
  </url>
</urlset>`
})
