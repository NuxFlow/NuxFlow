import { withEdgeCache } from '../utils/edge-cache'
import { requireSiteId } from '../utils/site-context'
import { buildPodcastFeed } from '../utils/podcast'
import { notFound } from '../utils/response'

// The podcast feed (Settings → Podcast) for Apple Podcasts, Spotify and other apps.
// Edge-cached like the other feeds; purged with them when content changes.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  const xml = await withEdgeCache(event, 3600, () => buildPodcastFeed(event, siteId))
  if (!xml) throw notFound('This site has no podcast')
  setHeader(event, 'Content-Type', 'application/rss+xml; charset=UTF-8')
  return xml
})
