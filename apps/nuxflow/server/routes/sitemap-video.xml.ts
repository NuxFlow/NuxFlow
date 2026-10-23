import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { escXml } from '../utils/xml'
import { getSeoSettings, siteBaseUrl } from '../utils/seo'
import { getIndexableEntries } from '../utils/sitemap-entries'
import { videosForEntries } from '../utils/video-seo'
import { requireSiteId } from '../utils/site-context'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildVideoSitemap(event))
})

// Pages scanned per build, newest first — same bound as the image sitemap.
const VIDEO_SITEMAP_PAGE_CAP = 1000

/**
 * Google video sitemap: each indexable page listed with the videos it shows (YouTube,
 * Vimeo and the site's own Cloudflare Stream videos, never private ones), so the page can
 * appear in Google's video results. `player_loc` is the embeddable player; descriptions
 * and thumbnails come from utils/video-seo.ts, shared with the pages' VideoObject data.
 */
async function buildVideoSitemap(event: H3Event) {
  const db = useReplicaDb(event)
  const siteId = requireSiteId(event)

  const [site, seo] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
    getSeoSettings(db, siteId),
  ])
  const rawBaseUrl = siteBaseUrl(seo, site?.domain, useRuntimeConfig().public.siteUrl as string)

  const { entries } = await getIndexableEntries(db, siteId, seo, VIDEO_SITEMAP_PAGE_CAP)
  const videos = await videosForEntries(db, siteId, entries, VIDEO_SITEMAP_PAGE_CAP)

  const urls = entries
    .filter(e => videos.has(e.id))
    .map((e) => {
      const tags = videos.get(e.id)!.map(v => [
        '    <video:video>',
        `      <video:thumbnail_loc>${escXml(v.thumbnailUrl)}</video:thumbnail_loc>`,
        `      <video:title>${escXml(v.name.slice(0, 100))}</video:title>`,
        `      <video:description>${escXml(v.description)}</video:description>`,
        `      <video:player_loc>${escXml(v.embedUrl)}</video:player_loc>`,
        v.durationSeconds ? `      <video:duration>${Math.min(v.durationSeconds, 28_800)}</video:duration>` : null,
        `      <video:publication_date>${escXml(v.uploadDate)}</video:publication_date>`,
        '    </video:video>',
      ].filter(Boolean).join('\n')).join('\n')
      return `  <url>\n    <loc>${escXml(`${rawBaseUrl}${e.path}`)}</loc>\n${tags}\n  </url>`
    })

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urls.join('\n')}
</urlset>`
}
