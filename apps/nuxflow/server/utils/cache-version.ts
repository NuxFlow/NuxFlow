import type { H3Event } from 'h3'
import { getCfBindings } from './cf-env'

// KVNamespace is a global ambient type from worker-configuration.d.ts — no import needed.

/**
 * Per-site cache version, stored in KV and included in every edge-cache key — the full-page
 * HTML cache (page-cache.ts) and the JSON/feed/Markdown cache (edge-cache.ts) — so that
 * "clear this site's cache" is one KV write instead of deleting entries one by one.
 *
 * Why not just delete entries: the Workers Cache API only ever touches the data centre
 * handling the current request, so a delete after an edit left every other location
 * serving the old page for up to the cache TTL (an hour). And a request may make at most
 * 1,000 Cache API calls, so clearing every page of a site stopped partway past ~250
 * pages. A new version number makes every old entry unreachable everywhere at once —
 * within about a minute, the time KV takes to show a new value in every location
 * (VERSION_CACHE_TTL_SECONDS plus the short in-isolate cache below). Old entries are never
 * deleted; they just stop being read and expire on their own.
 *
 * Where there's no KV binding (unit/integration tests, a deployment without PLUGIN_KV),
 * the version is a constant and edge-cache.ts falls back to deleting entries locally.
 */

const keyFor = (siteId: string) => `cache-version:${siteId}`

/** The version used when there's no KV binding to keep one in. */
export const FALLBACK_CACHE_VERSION = '0'

// How long KV keeps a read value in the reading location (Cloudflare's minimum is 30 s).
const VERSION_CACHE_TTL_SECONDS = 30
// On top of that, each isolate remembers the version briefly, since a single page render
// reads it several times (the page itself, then each JSON route its SSR fetches), and a
// busy isolate would otherwise pay a billed KV read for it every few seconds per site.
// KV itself takes up to about a minute to show a new value everywhere, so 15 s here barely
// moves the worst case; the isolate that made the edit sees the new version at once.
const ISOLATE_TTL_MS = 15_000
// KV accepts at most one write per second to the same key.
const MIN_WRITE_INTERVAL_MS = 1_100

const isolateCache = new Map<string, { value: string; expires: number }>()
const lastWriteAt = new Map<string, number>()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function readCacheVersion(kv: KVNamespace | null, siteId: string): Promise<string> {
  const cached = isolateCache.get(siteId)
  if (cached && cached.expires > Date.now()) return cached.value
  if (!kv) return FALLBACK_CACHE_VERSION

  let value: string
  try {
    value = (await kv.get(keyFor(siteId), { cacheTtl: VERSION_CACHE_TTL_SECONDS })) ?? FALLBACK_CACHE_VERSION
  } catch (err) {
    // Never break a page over this: keep using the last known version (or the fallback).
    console.error('[cache-version] read failed', err)
    return cached?.value ?? FALLBACK_CACHE_VERSION
  }
  isolateCache.set(siteId, { value, expires: Date.now() + ISOLATE_TTL_MS })
  return value
}

/**
 * Starts a new cache version for `siteId`. Returns false when there's no KV binding or the
 * write failed — callers then fall back to deleting entries locally.
 */
export async function bumpCacheVersionInKv(kv: KVNamespace | null, siteId: string): Promise<boolean> {
  if (!kv) return false

  const wait = (lastWriteAt.get(siteId) ?? 0) + MIN_WRITE_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)

  // A fresh random value rather than read-and-increment, so two writers racing can't both
  // land on the same "next" number. All that matters is that it differs from the last one.
  const value = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lastWriteAt.set(siteId, Date.now())
      await kv.put(keyFor(siteId), value)
      isolateCache.set(siteId, { value, expires: Date.now() + ISOLATE_TTL_MS })
      return true
    } catch (err) {
      // Most likely another isolate wrote the same key within the same second.
      if (attempt === 0) await sleep(MIN_WRITE_INTERVAL_MS)
      else console.error('[cache-version] write failed', err)
    }
  }
  return false
}

export function getCacheVersion(event: H3Event, siteId: string): Promise<string> {
  return readCacheVersion(getCfBindings(event).kv, siteId)
}

/** The current version for the request's own site (the fallback when no site resolved). */
export function currentCacheVersion(event: H3Event): Promise<string> {
  const siteId = (event.context.siteId ?? undefined)
  return siteId ? getCacheVersion(event, siteId) : Promise.resolve(FALLBACK_CACHE_VERSION)
}

export function bumpCacheVersion(event: H3Event, siteId: string): Promise<boolean> {
  return bumpCacheVersionInKv(getCfBindings(event).kv, siteId)
}

/** Query parameter carrying the cache version inside a cache key. */
export const CACHE_VERSION_PARAM = '__nfc'

/** `url` as a cache key under `version`. */
export function versionedCacheUrl(url: string, version: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${CACHE_VERSION_PARAM}=${encodeURIComponent(version)}`
}

/** Test hook: forget isolate-level state. */
export function resetCacheVersionState(): void {
  isolateCache.clear()
  lastWriteAt.clear()
}
