import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { media, sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq, like } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { escXml } from '../utils/xml'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/xml')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  return withEdgeCache(event, 3600, () => buildImageSitemap(event))
})

async function buildImageSitemap(event: H3Event) {
  // Anonymous, read-only, edge-cached — safe to read from a D1 read replica when one is
  // enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
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
    // The image-sitemap extension caps a single <url> entry at 1,000 <image:image>
    // children — this route puts every image under one <url> entry (the site root), so
    // that cap applies directly. It also bounds what was previously an unbounded query
    // (and unbounded response) on a media-heavy site.
    db.select({
      url: media.url,
      altText: media.altText,
      caption: media.caption,
    }).from(media).where(
      and(
        eq(media.siteId, siteId),
        like(media.mimeType, 'image/%'),
      ),
    ).limit(1000),
  ])

  const domainBase = site ? `https://${site.domain}` : config.public.siteUrl
  const baseUrl = escXml((canonicalSetting?.value as string | undefined)?.trim() || domainBase)

  const imageEntries = images
    .filter(img => img.url)
    .map(img => {
      const lines: string[] = [`    <image:loc>${escXml(img.url)}</image:loc>`]
      if (img.altText) lines.push(`    <image:title>${escXml(img.altText)}</image:title>`)
      if (img.caption) lines.push(`    <image:caption>${escXml(img.caption)}</image:caption>`)
      return `  <image:image>\n${lines.join('\n')}\n  </image:image>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${baseUrl}/</loc>
${imageEntries}
  </url>
</urlset>`
}
