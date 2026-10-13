import { describe, it, expect } from 'vitest'
import type { H3Event } from 'h3'
import { isPageCacheEligible, normalizePageCachePath, pageCacheKeysForUrl, pageCacheRequest, pageCacheVariant } from '../../server/utils/page-cache'

// getRequestURL and parseCookies are Nitro/H3 auto-imports in real server code — not
// Node/Vitest globals — so they're stubbed here against a minimal mock event shape this
// file controls directly, the same pattern edge-cache.test.ts uses for getRequestURL.
;(globalThis as Record<string, unknown>).getRequestURL = (event: H3Event) =>
  new URL((event as unknown as { _url: string })._url)
;(globalThis as Record<string, unknown>).parseCookies = (event: H3Event) =>
  (event as unknown as { _cookies?: Record<string, string> })._cookies ?? {}
;(globalThis as Record<string, unknown>).getHeader = (event: H3Event, name: string) =>
  (event as unknown as { _headers?: Record<string, string> })._headers?.[name.toLowerCase()]

function mkEvent(opts: { method?: string; url?: string; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  return {
    method: opts.method ?? 'GET',
    _url: opts.url ?? 'https://example.com/about',
    _cookies: opts.cookies ?? {},
    _headers: opts.headers ?? {},
  } as unknown as H3Event
}

describe('isPageCacheEligible', () => {
  it('allows a plain anonymous GET request with no cookies at all', () => {
    expect(isPageCacheEligible(mkEvent())).toBe(true)
  })

  // An API-key (Bearer) request is authenticated without any cookie; its SSR output can
  // include members-only content and must never be written to the shared cache.
  it('rejects a request carrying an Authorization header even with no cookies', () => {
    expect(isPageCacheEligible(mkEvent({ headers: { authorization: 'Bearer nxf_key' } }))).toBe(false)
  })

  it('rejects a non-GET request', () => {
    expect(isPageCacheEligible(mkEvent({ method: 'POST' }))).toBe(false)
  })

  // Fail-safe by design: any cookie not on the ignore list disqualifies the request — a
  // future plugin or feature adding a new cookie means "stop caching that request", never
  // "risk serving one visitor's personalized/private response to someone else".
  it('rejects a request carrying a session cookie', () => {
    expect(isPageCacheEligible(mkEvent({ cookies: { 'better-auth.session_token': 'abc123' } }))).toBe(false)
  })

  it('rejects an unrecognized cookie', () => {
    expect(isPageCacheEligible(mkEvent({ cookies: { i18n_redirected: 'en' } }))).toBe(false)
  })

  // Cookies nothing on the server reads — analytics scripts in custom head HTML, consent
  // banners, Cloudflare's bot management — must not turn the cache off for every
  // returning visitor.
  it('allows cookies that never change the rendered page', () => {
    expect(isPageCacheEligible(mkEvent({
      cookies: {
        _ga: 'GA1.1.1', _ga_ABC123: 'GS1.1', _gid: 'x', _fbp: 'fb.1', __cf_bm: 'x', _cfuvid: 'x',
        nuxflow_consent: '%7B%7D', nuxflow_push_dismissed: '1', CookieConsent: 'x', _pk_id_1_abcd: 'x',
      },
    }))).toBe(true)
  })

  it('still rejects a session cookie alongside ignorable ones', () => {
    expect(isPageCacheEligible(mkEvent({
      cookies: { _ga: 'GA1.1.1', '__Host-nuxflow_site': 'tok' },
    }))).toBe(false)
  })

  it('rejects a request carrying multiple cookies', () => {
    expect(isPageCacheEligible(mkEvent({
      cookies: { __nuxflow_theme_preview: 'theme-1', foo: 'bar' },
    }))).toBe(false)
  })

  for (const path of ['/admin', '/admin/settings', '/api/public/pages/about', '/_nuxt/entry.js']) {
    it(`rejects excluded path prefix: ${path}`, () => {
      expect(isPageCacheEligible(mkEvent({ url: `https://example.com${path}` }))).toBe(false)
    })
  }

  for (const path of ['/sitemap.xml', '/sitemap-images.xml', '/feed.xml', '/atom.xml', '/robots.txt', '/llms.txt']) {
    it(`rejects excluded exact path (has its own edge cache already): ${path}`, () => {
      expect(isPageCacheEligible(mkEvent({ url: `https://example.com${path}` }))).toBe(false)
    })
  }

  it('allows a real public page path', () => {
    expect(isPageCacheEligible(mkEvent({ url: 'https://example.com/blog/hello-world' }))).toBe(true)
  })
})

describe('normalizePageCachePath', () => {
  it('returns null when there is no query string', () => {
    expect(normalizePageCachePath('/about')).toBeNull()
  })

  it('returns null when no parameter is a tracking one', () => {
    expect(normalizePageCachePath('/blog?page=2')).toBeNull()
  })

  it('drops every tracking parameter and the query string with them', () => {
    expect(normalizePageCachePath('/about?utm_source=x&utm_medium=social&fbclid=abc')).toBe('/about')
    expect(normalizePageCachePath('/?gclid=1&srsltid=2&msclkid=3')).toBe('/')
  })

  it('keeps real parameters in their original order and encoding', () => {
    expect(normalizePageCachePath('/search?q=caf%C3%A9+au+lait&utm_campaign=x&page=2'))
      .toBe('/search?q=caf%C3%A9+au+lait&page=2')
  })

  it('matches tracking parameter names case-insensitively and when percent-encoded', () => {
    expect(normalizePageCachePath('/a?UTM_Source=x&%66bclid=y')).toBe('/a')
  })

  it('drops the internal cache-variant parameter so it cannot be smuggled into a key', () => {
    expect(normalizePageCachePath('/a?__nfv=r')).toBe('/a')
  })

  it('keeps a fragment after the query', () => {
    expect(normalizePageCachePath('/a?fbclid=x#top')).toBe('/a#top')
  })

  it('does not throw on a malformed escape', () => {
    expect(normalizePageCachePath('/a?%E0%A4%A=1&fbclid=x')).toBe('/a?%E0%A4%A=1')
  })
})

describe('pageCacheVariant', () => {
  it('is "r" for a visitor in a consent-required region', () => {
    expect(pageCacheVariant(mkEvent({ headers: { 'cf-ipcountry': 'DE' } }))).toBe('r')
    expect(pageCacheVariant(mkEvent({ headers: { 'cf-ipcountry': 'gb' } }))).toBe('r')
  })

  it('is "u" elsewhere, or when the country is unknown', () => {
    expect(pageCacheVariant(mkEvent({ headers: { 'cf-ipcountry': 'US' } }))).toBe('u')
    expect(pageCacheVariant(mkEvent())).toBe('u')
  })
})

describe('pageCacheRequest', () => {
  it('builds a GET Request keyed by the event URL plus its region variant', () => {
    const req = pageCacheRequest(mkEvent({ url: 'https://example.com/about' }), '0')
    expect(req.method).toBe('GET')
    expect(req.url).toBe('https://example.com/about?__nfv=u&__nfc=0')
  })

  it('ignores click-tracking parameters', () => {
    const req = pageCacheRequest(mkEvent({ url: 'https://example.com/blog?fbclid=x&page=2&utm_source=y' }), '0')
    expect(req.url).toBe('https://example.com/blog?page=2&__nfv=u&__nfc=0')
  })

  it('appends the variant after an existing query string', () => {
    const req = pageCacheRequest(mkEvent({ url: 'https://example.com/blog?page=2', headers: { 'cf-ipcountry': 'FR' } }), '0')
    expect(req.url).toBe('https://example.com/blog?page=2&__nfv=r&__nfc=0')
  })

  // A page rendered for one region must never be served to the other — the EU render holds
  // tracking code back until consent, the other injects it directly.
  it('gives the two regions different keys for the same URL', () => {
    const eu = pageCacheRequest(mkEvent({ headers: { 'cf-ipcountry': 'FR' } }), '0')
    const us = pageCacheRequest(mkEvent({ headers: { 'cf-ipcountry': 'US' } }), '0')
    expect(eu.url).not.toBe(us.url)
  })
})

describe('cache version in the key', () => {
  // A new site cache version (cache-version.ts) must make every old entry unreachable.
  it('gives each cache version its own key', () => {
    const before = pageCacheRequest(mkEvent(), 'v1').url
    const after = pageCacheRequest(mkEvent(), 'v2').url
    expect(before).toMatch(/__nfc=v1$/)
    expect(before).not.toBe(after)
  })

  it('drops a cache-version parameter from the incoming URL so it cannot pick a key', () => {
    expect(normalizePageCachePath('/a?__nfc=old')).toBe('/a')
  })
})

describe('pageCacheKeysForUrl', () => {
  it('returns one key per variant, matching what pageCacheRequest builds', () => {
    const keys = pageCacheKeysForUrl('https://example.com/about', '0').map(r => r.url)
    expect(keys).toEqual(['https://example.com/about?__nfv=u&__nfc=0', 'https://example.com/about?__nfv=r&__nfc=0'])
    expect(keys).toContain(pageCacheRequest(mkEvent({ headers: { 'cf-ipcountry': 'IE' } }), '0').url)
  })
})
