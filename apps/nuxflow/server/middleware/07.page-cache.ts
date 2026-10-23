import { getEdgeCache } from '../utils/edge-cache'
import { isPageCacheEligible, PAGE_BROWSER_CACHE_CONTROL, pageCacheRequest } from '../utils/page-cache'
import { currentCacheVersion } from '../utils/cache-version'

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

  const cache = getEdgeCache()

  try {
    // Read once, here, and reused by the write side (plugins/page-cache.ts): a page that
    // started rendering before an edit bumped the version must be saved under the old
    // version, never the new one.
    const version = await currentCacheVersion(event)
    event.context.pageCacheVersion = version
    const cached = await cache.match(pageCacheRequest(event, version))
    if (!cached) return

    const body = await cached.text()
    setHeader(event, 'Content-Type', cached.headers.get('content-type') ?? 'text/html; charset=utf-8')
    // The stored copy's own max-age is for Cloudflare's cache, not the visitor's browser.
    setHeader(event, 'Cache-Control', PAGE_BROWSER_CACHE_CONTROL)
    setHeader(event, 'X-NuxFlow-Page-Cache', 'HIT')
    setResponseStatus(event, 200)
    return body
  } catch (err) {
    console.error('[page-cache] read failed, falling through to normal render', err)
  }
})
