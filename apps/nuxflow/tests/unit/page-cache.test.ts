import { describe, it, expect, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import { isPageCacheEligible, pageCacheRequest } from '../../server/utils/page-cache'

// getRequestURL and parseCookies are Nitro/H3 auto-imports in real server code — not
// Node/Vitest globals — so they're stubbed here against a minimal mock event shape this
// file controls directly, the same pattern edge-cache.test.ts uses for getRequestURL.
;(globalThis as Record<string, unknown>).getRequestURL = (event: H3Event) =>
  new URL((event as unknown as { _url: string })._url)
;(globalThis as Record<string, unknown>).parseCookies = (event: H3Event) =>
  (event as unknown as { _cookies?: Record<string, string> })._cookies ?? {}

function mkEvent(opts: { method?: string; url?: string; cookies?: Record<string, string> } = {}) {
  return {
    method: opts.method ?? 'GET',
    _url: opts.url ?? 'https://example.com/about',
    _cookies: opts.cookies ?? {},
  } as unknown as H3Event
}

describe('isPageCacheEligible', () => {
  it('allows a plain anonymous GET request with no cookies at all', () => {
    expect(isPageCacheEligible(mkEvent())).toBe(true)
  })

  it('rejects a non-GET request', () => {
    expect(isPageCacheEligible(mkEvent({ method: 'POST' }))).toBe(false)
  })

  // Fail-safe by design: ANY cookie at all disqualifies the request, no allowlist — a
  // future plugin or feature adding a new cookie means "stop caching that request", never
  // "risk serving one visitor's personalized/private response to someone else". This used
  // to allowlist the (now-removed) @nuxtjs/i18n module's own `i18n_redirected` cookie
  // specifically; that module is gone, so there's nothing left to special-case — a request
  // carrying that exact cookie name today is just an unrecognized cookie like any other.
  it('rejects a request carrying any single cookie', () => {
    expect(isPageCacheEligible(mkEvent({ cookies: { 'better-auth.session_token': 'abc123' } }))).toBe(false)
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

describe('pageCacheRequest', () => {
  beforeEach(() => {
    // no-op: each test builds its own event
  })

  it('builds a GET Request keyed by the event\'s own resolved URL', () => {
    const event = mkEvent({ url: 'https://example.com/about?utm_source=x' })
    const req = pageCacheRequest(event)
    expect(req.method).toBe('GET')
    expect(req.url).toBe('https://example.com/about?utm_source=x')
  })
})
