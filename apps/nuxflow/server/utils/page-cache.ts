import type { H3Event } from 'h3'

/**
 * Full-page HTML edge cache — extends the same Cloudflare Cache API pattern already used
 * for the JSON data layer (see edge-cache.ts) to the actual rendered SSR document, so a
 * repeat visit to a public page skips Vue rendering entirely instead of just skipping the
 * D1 read behind it. A single source of truth (`isPageCacheEligible`) gates both the read
 * side (server/middleware) and the write side (server/plugins/page-cache.ts) — they must
 * agree, or a request that was cached could later become ineligible to read its own cache
 * entry (harmless, just a permanent miss) or vice versa (would need re-verifying safety).
 *
 * The core correctness question for any shared HTML cache is "can this response vary per
 * visitor, and if so, on what?" For an anonymous (no session) request to a public page,
 * this app's SSR output is a pure function of the URL, so the simple rule is: any cookie
 * present at all disqualifies the request (fail-safe — a future plugin or feature adding a
 * new cookie means "stop caching that request", never "risk serving one visitor's
 * personalized/private response to someone else").
 *
 * This used to carry a narrow allowlist for `i18n_redirected`, a cookie the (now-removed)
 * `@nuxtjs/i18n` module set automatically on literally every first visit — without it,
 * nearly every anonymous visitor's very first page view would look "not zero-cookie" and
 * the cache would rarely fire at all. That module is gone as of this codebase no longer
 * using it for anything (the app's actual multilingual content routing is a separate,
 * custom, purely URL-slug-based system with no cookie involved — see CLAUDE.md's
 * "Multilingual Content" section), so no visitor will ever have this cookie set again from
 * this point forward. A visitor who already has a stale copy of it from before this change
 * simply falls through to the general "unrecognized cookie present" case below and is
 * conservatively excluded from the cache until it expires or they clear it — exactly the
 * fail-safe behavior this function already applies to any other unrecognized cookie, so
 * this isn't a special case to keep carrying, just this rule doing what it always did.
 */

const EXCLUDED_PATH_PREFIXES = ['/admin', '/api', '/_']

// Non-HTML routes, most with their own existing edge-cache handling (withEdgeCache in
// edge-cache.ts) — excluded here so this cache never competes with or shadows theirs.
// (Belt-and-suspenders: the write side also refuses anything whose Content-Type isn't
// text/html, so none of these could actually get written into this cache regardless —
// this list exists for clarity and to avoid a wasted cache lookup on every request to
// one of them, not because the content-type gate wouldn't already protect against it.)
const EXCLUDED_EXACT_PATHS = new Set([
  '/sitemap.xml',
  '/sitemap-images.xml',
  '/feed.xml',
  '/atom.xml',
  '/events.ics',
  '/robots.txt',
  '/llms.txt',
])

export const PAGE_CACHE_TTL_SECONDS = 3600

export function isPageCacheEligible(event: H3Event): boolean {
  if (event.method !== 'GET') return false

  const path = getRequestURL(event).pathname
  if (EXCLUDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) return false
  if (EXCLUDED_EXACT_PATHS.has(path)) return false

  const cookies = parseCookies(event)
  return Object.keys(cookies).length === 0
}

export function pageCacheRequest(event: H3Event): Request {
  return new Request(getRequestURL(event).toString(), { method: 'GET' })
}
