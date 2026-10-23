import { and, eq, inArray } from 'drizzle-orm'
import { contentItems, videoAssets } from '@nuxflow/db/schema'
import { findVideoEmbeds, videoEmbedUrl, videoThumbnailUrl, videoWatchUrl, type VideoRef } from '@nuxflow/canvas/video'
import type { Db } from './db'
import { createIsolateCache } from './isolate-cache'
import type { IndexableEntry } from './sitemap-entries'

/**
 * What search engines are told about the videos on a page: the VideoObject structured
 * data on the page itself (via the public page API's `videos`) and `/sitemap-video.xml`.
 * Built from the page's Video blocks — YouTube, Vimeo, and the site's Cloudflare Stream
 * library. Private videos are never listed: their thumbnails and player need a signed
 * link, and they belong to pages that aren't meant to be found.
 *
 * Google needs a title, description, thumbnail and upload date for each video; anything
 * the block doesn't set falls back to the library entry, then to the page. A Vimeo
 * thumbnail can't be worked out from its id, so it's looked up once through Vimeo's public
 * oEmbed endpoint and kept for six hours per isolate; a video with no thumbnail is left out.
 */

export interface PageVideo {
  name: string
  description: string
  thumbnailUrl: string
  embedUrl: string
  /** The video's own page on its platform. */
  watchUrl: string
  /** ISO 8601 with time zone. */
  uploadDate: string
  /** ISO 8601 duration, e.g. PT3M20S. */
  duration?: string
  durationSeconds?: number
}

export interface VideoPageInfo {
  title: string
  description: string | null
  publishedAt: string | null
  updatedAt?: string | null
}

const MAX_VIDEOS_PER_PAGE = 20
const MAX_DESCRIPTION = 2048

/** D1's `datetime('now')` text ("2026-10-23 12:00:00") or an ISO string, as ISO 8601 UTC. */
export function isoDateTime(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
  const d = new Date(normalized)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function isoDuration(seconds: number | null | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${rest || (!h && !m) ? `${rest}S` : ''}`
}

interface VimeoInfo { thumbnailUrl: string | null; duration: number | null; uploadDate: string | null; title: string | null }
const vimeoCache = createIsolateCache<VimeoInfo>(6 * 60 * 60_000, 500)

/**
 * Thumbnail/duration/date of a Vimeo video from its public oEmbed endpoint; nulls when Vimeo
 * won't say. Null when it isn't cached and `allowFetch` is false.
 */
export async function vimeoInfo(ref: VideoRef, fetcher: typeof fetch = fetch, allowFetch = true): Promise<VimeoInfo | null> {
  const key = `${ref.id}/${ref.hash ?? ''}`
  const cached = vimeoCache.get(key)
  if (cached) return cached
  if (!allowFetch) return null
  let info: VimeoInfo = { thumbnailUrl: null, duration: null, uploadDate: null, title: null }
  try {
    const res = await fetcher(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoWatchUrl(ref))}&width=1280`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const data = await res.json() as { thumbnail_url?: unknown; duration?: unknown; upload_date?: unknown; title?: unknown }
      info = {
        thumbnailUrl: typeof data.thumbnail_url === 'string' && data.thumbnail_url.startsWith('https://') ? data.thumbnail_url : null,
        duration: typeof data.duration === 'number' ? data.duration : null,
        uploadDate: typeof data.upload_date === 'string' ? data.upload_date : null,
        title: typeof data.title === 'string' ? data.title : null,
      }
    }
  } catch {
    // Unreachable or slow: no thumbnail this time (cached, so a page isn't slowed again).
  }
  vimeoCache.set(key, info)
  return info
}

type LibraryRow = Pick<typeof videoAssets.$inferSelect, 'cloudflareStreamId' | 'title' | 'duration' | 'thumbnailUrl' | 'isPrivate' | 'watchPaused' | 'createdAt'>

async function libraryRows(db: Db, siteId: string, ids: string[]): Promise<Map<string, LibraryRow>> {
  if (!ids.length) return new Map()
  const rows = await db.select({
    cloudflareStreamId: videoAssets.cloudflareStreamId,
    title: videoAssets.title,
    duration: videoAssets.duration,
    thumbnailUrl: videoAssets.thumbnailUrl,
    isPrivate: videoAssets.isPrivate,
    watchPaused: videoAssets.watchPaused,
    createdAt: videoAssets.createdAt,
  }).from(videoAssets).where(and(eq(videoAssets.siteId, siteId), inArray(videoAssets.cloudflareStreamId, ids)))
  return new Map(rows.map(r => [r.cloudflareStreamId, r]))
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

interface DescribeOptions {
  /** Look up Vimeo thumbnails (network). The sitemap passes a shared budget. */
  vimeoBudget?: { remaining: number }
  fetcher?: typeof fetch
  /** Library rows already loaded for these pages (the sitemap loads them once). */
  library?: Map<string, LibraryRow>
}

/** The search-engine description of every public video on a page (Canvas or post), in page order. */
export async function describePageVideos(db: Db, siteId: string, content: unknown, page: VideoPageInfo, opts: DescribeOptions = {}): Promise<PageVideo[]> {
  const seen = new Set<string>()
  const found: Array<{ ref: VideoRef; props: Record<string, unknown> }> = []
  for (const { ref, props } of findVideoEmbeds(content)) {
    const key = `${ref.provider}:${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ ref, props })
    if (found.length >= MAX_VIDEOS_PER_PAGE) break
  }
  if (!found.length) return []

  const streamIds = found.filter(f => f.ref.provider === 'stream').map(f => f.ref.id)
  const library = opts.library ?? await libraryRows(db, siteId, streamIds)
  const pageDate = isoDateTime(page.publishedAt) ?? isoDateTime(page.updatedAt ?? null)

  const out: PageVideo[] = []
  for (const { ref, props } of found) {
    const row = ref.provider === 'stream' ? library.get(ref.id) : undefined
    // Private, or paused by the plan: its thumbnail and player need a signed link.
    if (row?.isPrivate || row?.watchPaused) continue

    let thumbnailUrl = ref.provider === 'stream' ? (row?.thumbnailUrl || videoThumbnailUrl(ref)) : videoThumbnailUrl(ref)
    let durationSeconds = row?.duration ?? undefined
    let uploadDate = isoDateTime(row?.createdAt) ?? pageDate
    let platformTitle: string | null = row?.title ?? null

    if (ref.provider === 'vimeo') {
      const budget = opts.vimeoBudget
      const cachedOnly = budget !== undefined && budget.remaining <= 0
      const info = await vimeoInfo(ref, opts.fetcher, !cachedOnly)
      if (info) {
        if (budget && !cachedOnly) budget.remaining--
        thumbnailUrl = info.thumbnailUrl
        durationSeconds = info.duration ?? undefined
        uploadDate = isoDateTime(info.uploadDate) ?? uploadDate
        platformTitle = info.title
      }
    }
    if (!thumbnailUrl || !uploadDate) continue

    const name = text(props.title) || text(props.caption) || platformTitle || page.title
    const description = (text(props.description) || page.description?.trim() || name).slice(0, MAX_DESCRIPTION)
    out.push({
      name,
      description,
      thumbnailUrl,
      embedUrl: videoEmbedUrl(ref),
      watchUrl: videoWatchUrl(ref),
      uploadDate,
      duration: isoDuration(durationSeconds),
      durationSeconds: durationSeconds && durationSeconds > 0 ? Math.round(durationSeconds) : undefined,
    })
  }
  return out
}

/** Does a page show any video at all? (Cheap check before any lookups.) */
export function hasVideoBlocks(content: unknown): boolean {
  return findVideoEmbeds(content).length > 0
}

/**
 * The public videos on each indexable page, for the video sitemap — content read in small
 * id-chunks like imagesForEntries(), library rows looked up per chunk, and at most
 * `vimeoLookups` Vimeo oEmbed calls per build (they're cached, so later builds catch up).
 */
export async function videosForEntries(db: Db, siteId: string, entries: IndexableEntry[], maxPages: number, vimeoLookups = 50): Promise<Map<string, PageVideo[]>> {
  const result = new Map<string, PageVideo[]>()
  const budget = { remaining: vimeoLookups }
  const scan = entries.slice(0, maxPages)
  const CHUNK = 25
  for (let i = 0; i < scan.length; i += CHUNK) {
    const chunk = scan.slice(i, i + CHUNK)
    const rows = await db.query.contentItems.findMany({
      where: and(eq(contentItems.siteId, siteId), inArray(contentItems.id, chunk.map(e => e.id))),
      columns: { id: true, content: true },
    })
    const withVideo = rows.filter(r => hasVideoBlocks(r.content))
    if (!withVideo.length) continue
    const streamIds = new Set<string>()
    for (const r of withVideo) {
      for (const { ref } of findVideoEmbeds(r.content)) {
        if (ref.provider === 'stream') streamIds.add(ref.id)
      }
    }
    const library = await libraryRows(db, siteId, [...streamIds])
    const byId = new Map(chunk.map(e => [e.id, e]))
    for (const r of withVideo) {
      const entry = byId.get(r.id)!
      const videos = await describePageVideos(db, siteId, r.content, {
        title: entry.title,
        description: entry.description,
        publishedAt: entry.publishedAt,
        updatedAt: entry.updatedAt,
      }, { vimeoBudget: budget, library })
      if (videos.length) result.set(r.id, videos)
    }
  }
  return result
}
