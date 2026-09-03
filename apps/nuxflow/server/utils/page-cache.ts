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
 * this app's SSR output is a pure function of the URL — with one caveat found by testing
 * the live site: @nuxtjs/i18n sets an `i18n_redirected` cookie on literally every first
 * visit. Gating on "zero cookies present" would mean the cache almost never fires for
 * anyone past their very first page view — nearly the whole optimization would be
 * theoretical. So that one specific, known cookie is allowlisted, but ONLY when its value
 * equals the site's configured default locale (today the only locale this install has) —
 * a request whose language cookie holds any other value is treated as potentially
 * rendering different (translated) content and is excluded, rather than guessed at. Any
 * cookie besides that one disqualifies the request outright — a future plugin or feature
 * adding a new cookie means "stop caching that request", never "risk serving one
 * visitor's personalized/private response to someone else".
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

function defaultLocale(): string {
  const i18n = useRuntimeConfig().public?.i18n as { defaultLocale?: string } | undefined
  return i18n?.defaultLocale ?? 'en'
}

export function isPageCacheEligible(event: H3Event): boolean {
  if (event.method !== 'GET') return false

  const path = getRequestURL(event).pathname
  if (EXCLUDED_PATH_PREFIXES.some(prefix => path.startsWith(prefix))) return false
  if (EXCLUDED_EXACT_PATHS.has(path)) return false

  const cookies = parseCookies(event)
  const cookieNames = Object.keys(cookies)
  if (cookieNames.length === 0) return true

  return cookieNames.length === 1
    && cookieNames[0] === 'i18n_redirected'
    && cookies.i18n_redirected === defaultLocale()
}

export function pageCacheRequest(event: H3Event): Request {
  return new Request(getRequestURL(event).toString(), { method: 'GET' })
}
