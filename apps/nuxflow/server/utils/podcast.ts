import type { H3Event } from 'h3'
import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { contentItems, contentTypes, media, sites } from '@nuxflow/db/schema'
import { useReplicaDb } from './db'
import { resolveSetting } from './settings'
import { validationError } from './response'
import { withPublicPaths } from './seo'
import { absoluteUrl } from './media-url'
import { escXml, cdataSafe } from './xml'
import { APPLE_CATEGORIES, audioMimeType, durationSeconds, parseEpisode, parsePodcastSettings, type PodcastSettings } from '../../shared/lib/podcast'

/**
 * A site's podcast (Settings → Podcast, one JSON setting) and its feed, /podcast.xml: RSS 2.0
 * with Apple's itunes tags, which Spotify and the other apps read too. Episodes are published
 * public items of the chosen content type with an audio file in `settings.podcast`. Saved
 * through the settings PATCH (no route of its own — another route address trips TS2589).
 */
export const PODCAST_SETTING_KEY = 'podcast.settings'

export async function getPodcastSettings(event: H3Event): Promise<PodcastSettings> {
  return parsePodcastSettings(await resolveSetting(event, PODCAST_SETTING_KEY))
}

const podcastSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().max(200),
  description: z.string().trim().max(4000),
  author: z.string().trim().max(200),
  ownerEmail: z.union([z.literal(''), z.string().trim().email('That owner email doesn\'t look right').max(254)]),
  coverImage: z.string().trim().max(2000),
  category: z.enum(APPLE_CATEGORIES as [string, ...string[]]),
  explicit: z.boolean(),
  contentType: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'Choose which content type holds the episodes'),
}).refine(p => !p.enabled || p.title, 'Give the podcast a title before switching it on')

/** Checks a `podcast.settings` value sent to the settings PATCH. Throws a 422. */
export function normalizePodcastSetting(value: unknown): PodcastSettings {
  const result = podcastSchema.safeParse(value)
  if (!result.success) throw validationError(`Podcast: ${result.error.issues[0]?.message ?? 'these settings aren\'t valid'}`)
  return parsePodcastSettings(result.data)
}

const MAX_EPISODES = 300

/** The feed's XML, or null when the podcast is off. */
export async function buildPodcastFeed(event: H3Event, siteId: string): Promise<string | null> {
  const podcast = await getPodcastSettings(event)
  if (!podcast.enabled) return null
  const db = useReplicaDb(event)
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true, domain: true, locale: true } })
  const base = `https://${site?.domain ?? ''}`

  const rows = await db.select({
    id: contentItems.id,
    title: contentItems.title,
    slug: contentItems.slug,
    locale: contentItems.locale,
    sourceItemId: contentItems.sourceItemId,
    excerpt: contentItems.excerpt,
    seoDescription: contentItems.seoDescription,
    ogImage: contentItems.ogImage,
    settings: contentItems.settings,
    publishedAt: contentItems.publishedAt,
    updatedAt: contentItems.updatedAt,
  }).from(contentItems).where(and(
    eq(contentItems.siteId, siteId),
    eq(contentItems.status, 'published'),
    eq(contentItems.visibility, 'public'),
    inArray(contentItems.typeId, db.select({ id: contentTypes.id }).from(contentTypes)
      .where(and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, podcast.contentType)))),
  )).orderBy(desc(contentItems.publishedAt)).limit(MAX_EPISODES)

  const episodes = rows.map(r => ({ ...r, episode: parseEpisode(r.settings) })).filter(r => r.episode)
  // File sizes and types from the library, for the enclosures (apps want a length).
  const urls = [...new Set(episodes.map(e => e.episode!.audioUrl))]
  const files = new Map<string, { size: number; mimeType: string }>()
  for (let i = 0; i < urls.length; i += 90) {
    const found = await db.select({ url: media.url, size: media.size, mimeType: media.mimeType }).from(media)
      .where(and(eq(media.siteId, siteId), inArray(media.url, urls.slice(i, i + 90))))
    for (const f of found) files.set(f.url, { size: f.size, mimeType: f.mimeType })
  }

  const items = (await withPublicPaths(db, siteId, episodes)).map((e) => {
    const ep = e.episode!
    const file = files.get(ep.audioUrl)
    const audio = absoluteUrl(ep.audioUrl, base)
    const link = `${base}${e.path}`
    const summary = e.excerpt || e.seoDescription || ''
    const seconds = ep.duration ? durationSeconds(ep.duration) : null
    const image = e.ogImage ? absoluteUrl(e.ogImage, base) : null
    return `
    <item>
      <title><![CDATA[${cdataSafe(e.title)}]]></title>
      <link>${escXml(link)}</link>
      <guid isPermaLink="false">${escXml(`${siteId}:${e.id}`)}</guid>
      <pubDate>${new Date(e.publishedAt ?? e.updatedAt).toUTCString()}</pubDate>
      ${summary ? `<description><![CDATA[${cdataSafe(summary)}]]></description>` : ''}
      <enclosure url="${escXml(audio)}" length="${file?.size ?? 0}" type="${escXml(file?.mimeType?.startsWith('audio/') ? file.mimeType : audioMimeType(ep.audioUrl))}" />
      ${seconds !== null ? `<itunes:duration>${seconds}</itunes:duration>` : ''}
      ${ep.episode ? `<itunes:episode>${ep.episode}</itunes:episode>` : ''}
      ${ep.season ? `<itunes:season>${ep.season}</itunes:season>` : ''}
      <itunes:explicit>${ep.explicit || podcast.explicit ? 'true' : 'false'}</itunes:explicit>
      ${image ? `<itunes:image href="${escXml(image)}" />` : ''}
    </item>`
  }).join('')

  const cover = podcast.coverImage ? absoluteUrl(podcast.coverImage, base) : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title><![CDATA[${cdataSafe(podcast.title)}]]></title>
    <link>${escXml(base)}</link>
    <language>${escXml(site?.locale || 'en')}</language>
    <description><![CDATA[${cdataSafe(podcast.description || podcast.title)}]]></description>
    <atom:link href="${escXml(`${base}/podcast.xml`)}" rel="self" type="application/rss+xml" />
    ${podcast.author ? `<itunes:author><![CDATA[${cdataSafe(podcast.author)}]]></itunes:author>` : ''}
    ${podcast.ownerEmail ? `<itunes:owner><itunes:name><![CDATA[${cdataSafe(podcast.author || podcast.title)}]]></itunes:name><itunes:email>${escXml(podcast.ownerEmail)}</itunes:email></itunes:owner>` : ''}
    ${cover ? `<itunes:image href="${escXml(cover)}" /><image><url>${escXml(cover)}</url><title><![CDATA[${cdataSafe(podcast.title)}]]></title><link>${escXml(base)}</link></image>` : ''}
    <itunes:category text="${escXml(podcast.category)}" />
    <itunes:explicit>${podcast.explicit ? 'true' : 'false'}</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    ${items}
  </channel>
</rss>`
}
