import { describe, it, expect, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import { isPageCacheEligible, pageCacheRequest } from '../../server/utils/page-cache'

// getRequestURL, parseCookies, and useRuntimeConfig are Nitro/H3 auto-imports in real
// server code — not Node/Vitest globals — so they're stubbed here against a minimal mock
// event shape this file controls directly, the same pattern edge-cache.test.ts uses for
// getRequestURL.
;(globalThis as Record<string, unknown>).getRequestURL = (event: H3Event) =>
  new URL((event as unknown as { _url: string })._url)
;(globalThis as Record<string, unknown>).parseCookies = (event: H3Event) =>
  (event as unknown as { _cookies?: Record<string, string> })._cookies ?? {}
;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
  public: { i18n: { defaultLocale: 'en' } },
})

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

  it('allows a request whose only cookie is the language redirect cookie at the default locale', () => {
    expect(isPageCacheEligible(mkEvent({ cookies: { i18n_redirected: 'en' } }))).toBe(true)
  })

  it('rejects a non-GET request', () => {
    expect(isPageCacheEligible(mkEvent({ method: 'POST' }))).toBe(false)
  })

  // The concrete, empirically-verified reason this allowlist-not-denylist design exists:
  // every first-time visitor to the live site picks up this exact cookie automatically
  // (confirmed via curl against production) — gating on "zero cookies" alone would mean
  // the cache almost never fires for anyone past their very first page view.
  it('rejects a request whose language cookie is set to a non-default locale (would render different content)', () => {
    expect(isPageCacheEligible(mkEvent({ cookies: { i18n_redirected: 'fr' } }))).toBe(false)
  })

  it('rejects a request carrying any cookie other than the language redirect cookie', () => {
    expect(isPageCacheEligible(mkEvent({ cookies: { 'better-auth.session_token': 'abc123' } }))).toBe(false)
  })

  it('rejects a request carrying the language cookie AND some other cookie', () => {
    expect(isPageCacheEligible(mkEvent({
      cookies: { i18n_redirected: 'en', __nuxflow_theme_preview: 'theme-1' },
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
