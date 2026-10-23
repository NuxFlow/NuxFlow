import type { H3Event } from 'h3'
import { isGdprCountry } from '@nuxflow/canvas/consent'
import { isTrackingParam, stripQueryParams } from '../../shared/lib/tracking-params'
import { CACHE_VERSION_PARAM, versionedCacheUrl } from './cache-version'

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
 * this app's SSR output depends on exactly two things:
 *
 * - The URL, minus click-tracking parameters (`utm_*`, `fbclid`, `gclid`, …) that no page
 *   reads. The cache key drops them (`normalizePageCachePath()`), so a click from a social
 *   post or ad shares one cache entry with the plain URL instead of rendering from scratch
 *   every time. The only place the rendered HTML records the URL is Nuxt's payload
 *   (`payload.path`), which app/plugins/payload-path.server.ts strips the same way — so one
 *   visitor's click id is never baked into HTML served to everyone else. The browser keeps
 *   the full URL (Nuxt re-adds the address bar's query string when the rendered path
 *   matches), so client-side analytics see the parameters as normal.
 * - Whether the visitor is in a region that needs prior consent for tracking code
 *   (`pageCacheVariant()`): site-settings-resolver.ts holds custom head/body code back for
 *   those visitors, and CanvasBlockGdpr serializes the same region check into the payload.
 *   The variant is part of the cache key. The visitor's own consent cookie deliberately
 *   isn't — regulated visitors always get the held-back version and the activation script
 *   promotes it client-side when consent exists, so the cookie never changes the HTML.
 *
 * Any cookie disqualifies the request (fail-safe — a future plugin or feature adding a new
 * cookie means "stop caching that request", never "risk serving one visitor's
 * personalized/private response to someone else") — except the ones in
 * `IGNORED_COOKIE_RES`, which nothing on the server reads: the consent cookie (see above),
 * Cloudflare's own bot-management cookies, and the first-party cookies analytics and
 * consent-banner scripts pasted into custom head HTML set. Without that list a site with
 * Google Analytics or a consent banner would render every page from scratch for every
 * returning visitor. Anything that identifies a *signed-in* user (Better Auth, site
 * sessions, previews) is deliberately absent from it.
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
  '/sitemap-video.xml',
  '/feed.xml',
  '/atom.xml',
  '/events.ics',
  '/robots.txt',
  '/llms.txt',
  '/llms-full.txt',
  '/indexnow-key.txt',
])

export const PAGE_CACHE_TTL_SECONDS = 3600

/**
 * What a cache-eligible page tells the *browser*. The fast copy lives in Cloudflare's
 * cache (above), so the browser shouldn't keep its own: with a max-age, a returning
 * visitor's browser kept showing a page for up to that long after it was edited — and a
 * zone's Browser Cache TTL setting (4 hours by default) stretched that further.
 */
export const PAGE_BROWSER_CACHE_CONTROL = 'no-cache'

// Cookies no server code reads, so they can't change what a page renders. Analytics
// cookies are matched by prefix because most carry a property id (`_ga_ABC123`,
// `_pk_id.1.a2b3`, `mp_<token>_mixpanel`).
const IGNORED_COOKIE_RES: RegExp[] = [
  // NuxFlow's own: the consent choice (see the module comment) and the push-prompt
  // dismissal, which only matters to a signed-in visitor — who has a session cookie anyway.
  /^nuxflow_consent$/,
  /^nuxflow_push_dismissed$/,
  // Left in returning visitors' browsers by older versions; nothing reads them any more.
  // `i18n_redirected` came from the removed @nuxtjs/i18n module (set on every first visit),
  // `nuxflow_cookie_consent` is the consent cookie's old name. Each turned caching off for
  // everyone who still has it.
  /^(?:i18n_redirected|nuxflow_cookie_consent)$/,
  // Cloudflare bot management / challenges.
  /^(?:__cf_bm|_cfuvid|cf_clearance)$/,
  // Google Analytics / Ads, Meta, Microsoft, TikTok, Pinterest, Reddit, Snap, LinkedIn,
  // Hotjar, Clarity, Matomo, HubSpot, Mixpanel, Segment.
  /^(?:_ga|_gid|_gcl_|_fbp|_fbc|_uet|_ttp|_tt_enable_cookie|_pin_unauth|_rdt_uuid|_scid|li_|_hj|_clck|_clsk|_pk_|__hs|hubspotutk|mp_|ajs_)/,
  // Third-party consent banners.
  /^(?:CookieConsent|OptanonConsent|OptanonAlertBoxClosed|cookieyes-consent|cc_cookie)$/,
]

function isIgnoredCookie(name: string): boolean {
  return IGNORED_COOKIE_RES.some(re => re.test(name))
}

// Query parameter carrying the cache variant inside a cache key — never a real URL, but
// dropped from incoming requests too (as is the cache-version parameter) so one can't be
// smuggled into a key.
const VARIANT_PARAM = '__nfv'

/**
 * The request path (pathname + query) with click-tracking parameters (`utm_*`, `fbclid`,
 * … — see shared/lib/tracking-params.ts) removed, or `null` when there were none.
 */
export function normalizePageCachePath(path: string): string | null {
  return stripQueryParams(path, key => isTrackingParam(key) || key === VARIANT_PARAM || key === CACHE_VERSION_PARAM)
}

/** True when this pathname is a page the HTML cache can hold (ignoring method/cookies). */
export function isPageCachePath(pathname: string): boolean {
  if (EXCLUDED_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))) return false
  return !EXCLUDED_EXACT_PATHS.has(pathname)
}

export function isPageCacheEligible(event: H3Event): boolean {
  if (event.method !== 'GET') return false
  // The accounts origin (central sign-in) is never cached — it serves no site content and
  // its pages are marked no-store (03.accounts-routing.ts).
  if (event.context?.isAccountsHost) return false

  if (!isPageCachePath(getRequestURL(event).pathname)) return false

  // An Authorization header is a credential just like a cookie: an API-key request for a
  // members-only page renders that member's view during SSR, which must never be written
  // into a cache every anonymous visitor then reads from.
  if (getHeader(event, 'authorization')) return false

  const cookies = parseCookies(event)
  return Object.keys(cookies).every(isIgnoredCookie)
}

/** Every variant a page can be cached under — see `pageCacheVariant()`. */
export const PAGE_CACHE_VARIANTS = ['u', 'r'] as const
export type PageCacheVariant = typeof PAGE_CACHE_VARIANTS[number]

/**
 * `r` for a visitor in a region where tracking code needs prior consent, `u` otherwise.
 * Mirrors the region check site-settings-resolver.ts and CanvasBlockGdpr make while
 * rendering, so a page rendered for one region is never served to the other.
 */
export function pageCacheVariant(event: H3Event): PageCacheVariant {
  return isGdprCountry(getHeader(event, 'cf-ipcountry')) ? 'r' : 'u'
}

function variantKey(url: string, variant: PageCacheVariant, version: string): Request {
  const sep = url.includes('?') ? '&' : '?'
  return new Request(versionedCacheUrl(`${url}${sep}${VARIANT_PARAM}=${variant}`, version), { method: 'GET' })
}

/** The cache key for this request under the site's current cache version (cache-version.ts). */
export function pageCacheRequest(event: H3Event, version: string): Request {
  const url = getRequestURL(event)
  const path = url.pathname + url.search
  return variantKey(url.origin + (normalizePageCachePath(path) ?? path), pageCacheVariant(event), version)
}

/** The cache keys to delete to purge one page URL (absolute) under `version` — one per variant. */
export function pageCacheKeysForUrl(url: string, version: string): Request[] {
  return PAGE_CACHE_VARIANTS.map(variant => variantKey(url, variant, version))
}
