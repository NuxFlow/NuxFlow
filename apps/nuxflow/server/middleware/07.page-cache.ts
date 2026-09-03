import type { EdgeCacheStorage } from '../utils/edge-cache'
import { isPageCacheEligible, pageCacheRequest } from '../utils/page-cache'

// Ordering matters here and Nitro loads server/middleware/** in filename order, which is
// why this is numbered rather than left to sort alphabetically after 04.auth-override.ts —
// it must run:
//   - after 02.multi-site.ts, so a site in maintenance mode never serves a stale cached
//     page (that middleware already short-circuits with its own response before this
//     one runs)
//   - after 05.redirects.ts, so a newly-added redirect for a URL that used to be a real
//     (and possibly already-cached) page takes effect immediately instead of being
//     shadowed by a stale cache hit until it expires or gets purged
//   - after 06.theme-preview.ts, so an admin's theme-preview session (cookie + context)
//     is fully resolved before this decides whether the request is cacheable — though
//     isPageCacheEligible's cookie allowlist already excludes any authenticated request
//     on its own, since previewing requires a real session
//
// A cache hit here fully replaces Nitro's render pipeline for this request — no D1 read,
// no Vue SSR, nothing downstream of this middleware runs at all.
export default defineEventHandler(async (event) => {
  if (!isPageCacheEligible(event)) return

  const cf = event.context.cloudflare
  if (!cf?.request) return

  const cache = (caches as unknown as EdgeCacheStorage).default

  try {
    const cached = await cache.match(pageCacheRequest(event))
    if (!cached) return

    const body = await cached.text()
    setHeader(event, 'Content-Type', cached.headers.get('content-type') ?? 'text/html; charset=utf-8')
    setHeader(event, 'Cache-Control', cached.headers.get('cache-control') ?? 'public, max-age=3600')
    setHeader(event, 'X-NuxFlow-Page-Cache', 'HIT')
    setResponseStatus(event, 200)
    return body
  } catch (err) {
    console.error('[page-cache] read failed, falling through to normal render', err)
  }
})
