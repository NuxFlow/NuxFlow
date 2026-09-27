import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { escXml } from '../utils/xml'
import { absoluteUrl } from '../utils/media-url'
import { getSeoSettings, siteBaseUrl } from '../utils/seo'
import { getIndexableEntries, imagesForEntries } from '../utils/sitemap-entries'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildImageSitemap(event))
})

// Pages scanned for images per build. Each page's content is read (in small chunks), so
// this bounds both D1 reads and the response on a very large site; newest pages first.
const IMAGE_SITEMAP_PAGE_CAP = 1000

/**
 * Google image sitemap: each indexable page listed with the images it actually shows
 * (its featured image plus every image referenced in its body). An image must be listed
 * under the page it appears on — the previous version put every media-library image under
 * the homepage, including images only used in drafts or members-only content. `image:title`
 * and `image:caption` are omitted: Google stopped supporting them in 2022; alt text in the
 * page itself is what's used.
 */
async function buildImageSitemap(event: H3Event) {
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string

  const [site, seo] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
    getSeoSettings(db, siteId),
  ])
  const rawBaseUrl = siteBaseUrl(seo, site?.domain, useRuntimeConfig().public.siteUrl as string)

  const { entries } = await getIndexableEntries(db, siteId, seo, IMAGE_SITEMAP_PAGE_CAP)
  const images = await imagesForEntries(db, siteId, entries, IMAGE_SITEMAP_PAGE_CAP)

  const urls = entries
    .filter(e => images.has(e.id))
    .map((e) => {
      const tags = images.get(e.id)!
        .filter(u => !u.startsWith('data:'))
        .map(u => `    <image:image><image:loc>${escXml(absoluteUrl(u, rawBaseUrl))}</image:loc></image:image>`)
        .join('\n')
      return `  <url>\n    <loc>${escXml(`${rawBaseUrl}${e.path}`)}</loc>\n${tags}\n  </url>`
    })

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>`
}
