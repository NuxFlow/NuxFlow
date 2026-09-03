import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { contentItems } from '@nuxflow/db/schema'
import { useDb } from './db'

// `dom` and `webworker` (both in this project's tsconfig lib list) each declare their own
// standard CacheStorage — neither has `.default`, which is a Cloudflare-specific extension
// not in that spec — and that declaration shadows the real one generated into
// worker-configuration.d.ts. Same class of DOM/workerd global-type collision documented for
// Response.json() elsewhere in this codebase; worked around the same way, with an explicit
// cast through a narrow local type covering only what's used here.
export interface EdgeCacheStorage {
  default: {
    match(request: RequestInfo | URL): Promise<Response | undefined>
    put(request: RequestInfo | URL, response: Response): Promise<void>
    delete(request: RequestInfo | URL): Promise<boolean>
  }
}

/**
 * Cloudflare's Workers Cache API (`caches.default`) — a real cross-isolate,
 * cross-request edge cache, unlike an isolate-memory Map.
 *
 * The cache key is built from *this event's own* resolved URL (`getRequestURL(event)`),
 * not from `event.context.cloudflare.request` directly. That distinction matters: Nitro's
 * `cloudflare-module` preset populates `.cloudflare` once per top-level Worker invocation,
 * and nested/internal dispatches (e.g. a page component's own server-side fetch of one of
 * its own API routes during SSR) inherit that same context rather than getting a fresh
 * one — so `cf.request` still points at the *outer* page's URL, not the nested endpoint's.
 * Reusing it verbatim as the cache key made every distinct internal fetch issued while
 * rendering one outer page collide on a single shared key, each one liable to read back
 * whatever unrelated response another of them had most recently written. Deriving the key
 * from `getRequestURL(event)` instead keys correctly off the route actually being served,
 * whether reached externally or via internal dispatch.
 *
 * TTL-only, no explicit invalidation on write: the cached response's own Cache-Control
 * governs how long the edge holds it, matching the same staleness window callers of
 * these routes are already told to expect via their own Cache-Control header. Cache API
 * has no cross-colo replication, so this reduces D1 load on a hot colo/isolate rather
 * than guaranteeing a single global cache.
 *
 * Falls back to computing directly wherever the Cloudflare runtime context isn't present
 * (unit/integration tests, or any non-Workers environment) — `event.context.cloudflare`
 * is only populated by the `cloudflare-module` Nitro preset.
 *
 * Only a successful compute() result is ever cached — a thrown error (e.g. a 404) is
 * never written to the edge cache.
 *
 * A caching layer must never be able to break the request it's optimizing: every Cache
 * API interaction below is wrapped so a read failure falls through to compute() and a
 * write failure is swallowed after logging — compute()'s result is always what gets
 * returned either way.
 */
export async function withEdgeCache<T>(
  event: H3Event,
  maxAgeSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const cf = event.context.cloudflare
  if (!cf?.request) return compute()

  const cacheKey = new Request(getRequestURL(event).toString(), { method: 'GET' })
  const cache = (caches as unknown as EdgeCacheStorage).default

  try {
    const cached = await cache.match(cacheKey)
    if (cached) return await (cached.json() as Promise<T>)
  } catch (err) {
    console.error('[edge-cache] read failed, falling back to compute()', err)
  }

  const data = await compute()

  try {
    const response = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${maxAgeSeconds}`,
      },
    })
    const put = cache.put(cacheKey, response).catch(err => console.error('[edge-cache] write failed', err))
    if (cf.ctx?.waitUntil) {
      cf.ctx.waitUntil(put)
    } else {
      await put
    }
  } catch (err) {
    console.error('[edge-cache] write failed', err)
  }

  return data
}

/**
 * Purge-on-write: deletes cached entries for one or more site-relative paths
 * (e.g. `/api/public/pages/about`) immediately, instead of waiting out their
 * TTL. Mutation routes call this after a successful write so visitors see the
 * change on their next request rather than up to an hour later — the TTL in
 * `withEdgeCache` is a ceiling on staleness, not the only way it clears.
 *
 * `event.context.cloudflare.request` gates this the same way `withEdgeCache`
 * does — a no-op wherever the Cloudflare runtime context isn't present (unit/
 * integration tests, or any non-Workers environment). Each deletion is
 * independent and failures are logged, never thrown — a cache purge failing
 * must not fail the mutation that triggered it.
 */
export async function purgeEdgeCache(event: H3Event, paths: string[]): Promise<void> {
  const cf = event.context.cloudflare
  if (!cf?.request || paths.length === 0) return

  const cache = (caches as unknown as EdgeCacheStorage).default
  const origin = getRequestURL(event).origin

  await Promise.all(paths.map(async (path) => {
    try {
      await cache.delete(new Request(`${origin}${path}`, { method: 'GET' }))
    } catch (err) {
      console.error('[edge-cache] purge failed for', path, err)
    }
  }))
}

// Site-wide views that could include any given content item — cheap to always purge on
// any content write rather than working out which of them actually changed. Paginated
// variants (e.g. `/api/public/posts?page=2`) keep their own short TTL and aren't purged
// individually; only the unparameterized first-page URL is cached under an exact match.
// Includes both the JSON data view and (now that server/plugins/page-cache.ts caches full
// rendered pages too) the actual page(s) built from it — `/blog` didn't need an entry here
// before that existed, since nothing cached its rendered HTML at all.
const GLOBAL_CONTENT_CACHE_PATHS = [
  '/api/public/posts',
  '/blog',
  '/sitemap.xml',
  '/sitemap-images.xml',
  '/feed.xml',
  '/atom.xml',
  '/llms.txt',
]

// The homepage is a special case: its content item has slug 'home', but it's actually
// served (and, now, page-cached) at the site root, not at /home — see app/pages/index.vue,
// which hardcodes fetching '/api/public/pages/home' regardless of the requested path.
function pagePathForSlug(slug: string): string {
  return slug === 'home' ? '/' : `/${slug}`
}

/**
 * Purges the edge cache for a content item's own page(s) plus every site-wide
 * view that could list it (blog index, sitemaps, feeds, llms.txt) and any
 * taxonomy archive pages it's currently tagged under. Call after any create/
 * update/delete of a content item.
 */
export async function purgeContentCache(
  event: H3Event,
  opts: { slugs: string[]; taxonomyTerms?: { taxonomySlug: string; termSlug: string }[] },
): Promise<void> {
  const uniqueSlugs = [...new Set(opts.slugs.filter(Boolean)).values()]
  const jsonPaths = uniqueSlugs.map(slug => `/api/public/pages/${slug}`)
  const pagePaths = uniqueSlugs.map(pagePathForSlug)

  const taxonomyJsonPaths = (opts.taxonomyTerms ?? [])
    .map(t => `/api/public/taxonomy/${t.taxonomySlug}/${t.termSlug}`)
  const taxonomyPagePaths = (opts.taxonomyTerms ?? [])
    .map(t => `/${t.taxonomySlug}/${t.termSlug}`)

  await purgeEdgeCache(event, [
    ...jsonPaths, ...pagePaths,
    ...GLOBAL_CONTENT_CACHE_PATHS,
    ...taxonomyJsonPaths, ...taxonomyPagePaths,
  ])
}

/**
 * Purges every published/public page's cached HTML for a site, plus the site-wide views.
 *
 * Page-level caching (server/plugins/page-cache.ts) caches the FULL rendered document —
 * header, footer, and every other piece of shared site chrome included — not just a
 * content item's own data the way the JSON layer does. That means a change to something
 * that renders on *every* page (site name/appearance settings, or a menu assigned to the
 * header/footer location) can't be purged by naming a handful of known paths the way
 * purgeContentCache does for a single content item's own change; every currently-cached
 * page needs invalidating, since every one of them has that same stale chrome baked in.
 *
 * Cloudflare's Cache API has no bulk/prefix purge — only purge-by-exact-URL — so this
 * enumerates every published, public content item's slug and purges each individually.
 * Call sites should route this through `waitUntil` rather than awaiting it inline: it's
 * only triggered by relatively rare admin actions (saving appearance settings, editing a
 * header/footer menu), and there's no reason to make the admin's save wait on it.
 */
export async function purgeAllPublicPages(event: H3Event, siteId: string): Promise<void> {
  const cf = event.context.cloudflare
  if (!cf?.request) return

  const db = useDb(event)
  const rows = await db.query.contentItems.findMany({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.status, 'published'),
      eq(contentItems.visibility, 'public'),
    ),
    columns: { slug: true },
  })

  const pagePaths = rows.map(r => pagePathForSlug(r.slug))
  await purgeEdgeCache(event, [...new Set(['/', ...pagePaths, ...GLOBAL_CONTENT_CACHE_PATHS])])
}
