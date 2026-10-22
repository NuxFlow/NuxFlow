import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { getFeedSite, getPublishedPostsForFeed } from '@nuxflow/db/queries'
import { withEdgeCache } from '../utils/edge-cache'
import { escXml, cdataSafe } from '../utils/xml'
import { withPublicPaths } from '../utils/seo'
import { renderTipTap } from '../../shared/lib/render-tiptap'
import { absoluteUrl, absolutizeHtmlUrls } from '../utils/media-url'
import { resolvePublicTermFilter, termArchivePath, termFeedPath } from '../utils/taxonomy'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'application/rss+xml; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildFeed(event))
})

async function buildFeed(event: H3Event) {
  // Anonymous, read-only, edge-cached — safe to read from a D1 read replica when one is
  // enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  // `?taxonomy=category&term=news` → a per-term feed (sub-terms included), linked from
  // that term's archive page. An unknown term is a 404 rather than the whole-site feed,
  // so a subscriber never silently gets posts they didn't ask for.
  const query = getQuery(event)
  const taxonomySlug = typeof query.taxonomy === 'string' ? query.taxonomy : ''
  const termSlug = typeof query.term === 'string' ? query.term : ''
  const termFilter = taxonomySlug && termSlug ? await resolvePublicTermFilter(db, siteId, taxonomySlug, termSlug) : null
  if ((taxonomySlug || termSlug) && !termFilter) throw notFound('Feed not found')

  const [site, posts] = await Promise.all([
    getFeedSite(db, siteId),
    getPublishedPostsForFeed(db, siteId, 20, termFilter?.termIds),
  ])
  const rawBaseUrl = site ? `https://${site.domain}` : config.public.siteUrl
  const baseUrl = escXml(rawBaseUrl)
  const siteName = escXml(site?.name ?? 'NuxFlow')
  const channelTitle = termFilter ? `${siteName} — ${escXml(termFilter.term.name)}` : siteName
  const channelLink = termFilter ? `${baseUrl}${escXml(termArchivePath(taxonomySlug, termSlug))}` : baseUrl
  const selfLink = termFilter ? `${baseUrl}${escXml(termFeedPath(taxonomySlug, termSlug))}` : `${baseUrl}/feed.xml`

  const items = (await withPublicPaths(db, siteId, posts)).map((p) => {
    const contentObj = p.content as Record<string, unknown> | null
    const isCanvas = contentObj?.type === 'canvas'
    // Worker-served media (/_nuxflow/media/...) is site-relative; feed readers need absolute URLs.
    const fullHtml = !isCanvas && contentObj ? absolutizeHtmlUrls(renderTipTap(contentObj), rawBaseUrl) : ''
    const image = p.ogImage ? absoluteUrl(p.ogImage, rawBaseUrl) : null
    const summary = p.excerpt ?? ''
    const itemUrl = `${baseUrl}${escXml(p.path)}`
    return `
    <item>
      <title><![CDATA[${cdataSafe(p.title)}]]></title>
      <link>${itemUrl}</link>
      <guid isPermaLink="true">${itemUrl}</guid>
      <pubDate>${new Date(p.publishedAt ?? p.updatedAt).toUTCString()}</pubDate>
      ${summary ? `<description><![CDATA[${cdataSafe(summary)}]]></description>` : ''}
      ${fullHtml ? `<content:encoded><![CDATA[${cdataSafe(fullHtml)}]]></content:encoded>` : ''}
      ${p.authorName ? `<author>${escXml(p.authorName)}</author>` : ''}
      ${image ? `<media:thumbnail url="${escXml(image)}" /><media:content url="${escXml(image)}" medium="image" />` : ''}
    </item>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${channelTitle}</title>
    <link>${channelLink}</link>
    <description>Latest posts from ${channelTitle}</description>
    <atom:link href="${selfLink}" rel="self" type="application/rss+xml" />
    <atom:link href="${baseUrl}/atom.xml" rel="alternate" type="application/atom+xml" />
    ${items}
  </channel>
</rss>`
}
