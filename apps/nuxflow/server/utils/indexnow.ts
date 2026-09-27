import { contentItems, contentTypes, rateLimits, sites } from '@nuxflow/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from './db'
import { getSeoSettings, isItemIndexable, publicPathForItem, siteBaseUrl } from './seo'

/**
 * IndexNow (https://www.indexnow.org) — tells participating search engines (Bing, Yandex,
 * Seznam, Naver, and others via the shared api.indexnow.org endpoint) the moment a URL is
 * published, changed, or removed, instead of waiting for them to recrawl. Google does not
 * participate; it still discovers changes through the sitemap.
 *
 * Implemented natively rather than via Cloudflare's Crawler Hints because Crawler Hints
 * infers "content changed" from origin cache misses on the zone's CDN cache, which a
 * Worker-rendered site like this one doesn't go through — and because it's a per-zone
 * toggle, while this is per tenant. Opt-in per site (Admin → SEO → Indexing), which also
 * generates the site's key; the key is served at /indexnow-key.txt (keyLocation).
 */

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const MAX_URLS_PER_REQUEST = 10_000
// An editor autosaves a published page every few seconds while typing — one ping per URL
// per window is plenty (engines recrawl on their own schedule anyway).
const THROTTLE_MINUTES = 10

/** 32 hex chars — IndexNow requires 8–128 of [a-zA-Z0-9-]. */
export function generateIndexNowKey(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Atomically claims the per-URL throttle slot: true only for the first call in a window.
 * Reuses the `rate_limits` table (and its pruning in prune-old-data) via a single
 * INSERT … ON CONFLICT … RETURNING, the same race-free pattern rate-limit.ts uses.
 */
async function claimThrottle(db: Db, key: string): Promise<boolean> {
  const window = `+${THROTTLE_MINUTES} minutes`
  const rows = await db.insert(rateLimits)
    .values({ key, count: 1, resetAt: sql`datetime('now', ${window})` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN datetime(${rateLimits.resetAt}) < datetime('now') THEN 1 ELSE ${rateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN datetime(${rateLimits.resetAt}) < datetime('now') THEN datetime('now', ${window}) ELSE ${rateLimits.resetAt} END`,
      },
    })
    .returning({ count: rateLimits.count })
  return rows[0]?.count === 1
}

export interface IndexNowResult { submitted: string[]; status?: number; skipped?: 'disabled' | 'noindex' | 'no-key' | 'nothing-new' }

/**
 * Submits site-relative paths for a site. No-ops (with a reason) when IndexNow is off for
 * the site, the whole site is noindexed, or every path was already submitted within the
 * throttle window. Never throws on a network/endpoint failure — the result carries the
 * HTTP status instead — since this always runs in the background after a content write.
 */
export async function submitToIndexNow(db: Db, siteId: string, paths: string[], opts: { throttle?: boolean } = {}): Promise<IndexNowResult> {
  const seo = await getSeoSettings(db, siteId)
  if (!seo.indexnowEnabled) return { submitted: [], skipped: 'disabled' }
  if (seo.noindex) return { submitted: [], skipped: 'noindex' }
  if (!seo.indexnowKey) return { submitted: [], skipped: 'no-key' }

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } })
  const base = siteBaseUrl(seo, site?.domain)
  if (!base) return { submitted: [], skipped: 'no-key' }
  const host = new URL(base).host

  const unique = [...new Set(paths.filter(p => p.startsWith('/')))]
  const urls: string[] = []
  for (const path of unique) {
    const url = `${base}${path === '/' ? '/' : path}`
    if (opts.throttle === false || await claimThrottle(db, `indexnow:${siteId}:${path}`)) urls.push(url)
  }
  if (urls.length === 0) return { submitted: [], skipped: 'nothing-new' }

  let status: number | undefined
  for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
    const urlList = urls.slice(i, i + MAX_URLS_PER_REQUEST)
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key: seo.indexnowKey, keyLocation: `${base}/indexnow-key.txt`, urlList }),
      })
      status = res.status
      // 200/202 = accepted. 403/422 mean the key file couldn't be verified or a URL
      // doesn't belong to the host — a config problem worth surfacing in logs.
      if (res.status >= 400) console.warn(`[indexnow] ${host}: endpoint returned ${res.status}`)
    } catch (err) {
      console.error(`[indexnow] ${host}: submission failed`, err)
    }
  }
  return { submitted: urls, status }
}

interface ItemRef { slug: string; locale?: string | null; sourceItemId?: string | null; typeId?: string | null; metaRobots?: string | null }

/**
 * Public paths for a set of content items (translations resolve to /{locale}/{source
 * slug}, the homepage to /), skipping any the site wouldn't index anyway.
 */
export async function indexablePathsForItems(db: Db, siteId: string, items: ItemRef[]): Promise<string[]> {
  if (items.length === 0) return []
  const seo = await getSeoSettings(db, siteId)
  const sourceIds = [...new Set(items.map(i => i.sourceItemId).filter((x): x is string => Boolean(x)))]
  const typeIds = [...new Set(items.map(i => i.typeId).filter((x): x is string => Boolean(x)))]
  // Chunked: D1 caps a statement at 100 bound parameters.
  const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / 90) }, (_, i) => ids.slice(i * 90, i * 90 + 90))
  const [site, sources, types] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { locale: true } }),
    Promise.all(chunks(sourceIds).map(ids => db.query.contentItems.findMany({ where: and(eq(contentItems.siteId, siteId), inArray(contentItems.id, ids)), columns: { id: true, slug: true } }))).then(r => r.flat()),
    Promise.all(chunks(typeIds).map(ids => db.query.contentTypes.findMany({ where: inArray(contentTypes.id, ids), columns: { id: true, slug: true } }))).then(r => r.flat()),
  ])
  const sourceSlug = new Map(sources.map(s => [s.id, s.slug]))
  const typeSlug = new Map(types.map(t => [t.id, t.slug]))
  const defaultLocale = site?.locale || 'en'

  return items
    .filter(i => isItemIndexable({ metaRobots: i.metaRobots, typeSlug: i.typeId ? typeSlug.get(i.typeId) : null }, seo))
    .map(i => publicPathForItem({ slug: i.slug, locale: i.locale, sourceSlug: i.sourceItemId ? sourceSlug.get(i.sourceItemId) : null }, defaultLocale))
}
