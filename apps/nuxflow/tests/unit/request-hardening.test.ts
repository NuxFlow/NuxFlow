import { describe, it, expect } from 'vitest'
import type { H3Event } from 'h3'
import { isCrossOriginUnsafeRequest } from '../../server/utils/csrf'
import { confinePluginResponseHeaders } from '../../server/utils/plugin-response'

// getHeader is a Nitro/H3 auto-import in real server code — stubbed here against a minimal
// mock event shape, the same pattern page-cache.test.ts uses.
;(globalThis as Record<string, unknown>).getHeader = (event: H3Event, name: string) =>
  (event as unknown as { _headers: Record<string, string> })._headers[name.toLowerCase()]

function mkEvent(method: string, headers: Record<string, string>) {
  return { method, _headers: headers } as unknown as H3Event
}

const COOKIE = { cookie: 'better-auth.session_token=abc', host: 'site-a.example.com' }

describe('isCrossOriginUnsafeRequest', () => {
  it('allows safe methods regardless of origin', () => {
    expect(isCrossOriginUnsafeRequest(mkEvent('GET', { ...COOKIE, 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })

  it('allows requests with no cookie (API keys, webhooks, credential-less plugin calls)', () => {
    expect(isCrossOriginUnsafeRequest(mkEvent('POST', { host: 'site-a.example.com', origin: 'https://evil.test' }))).toBe(false)
  })

  it('allows same-origin requests (Sec-Fetch-Site)', () => {
    expect(isCrossOriginUnsafeRequest(mkEvent('POST', { ...COOKIE, 'sec-fetch-site': 'same-origin' }))).toBe(false)
    expect(isCrossOriginUnsafeRequest(mkEvent('PATCH', { ...COOKIE, 'sec-fetch-site': 'none' }))).toBe(false)
  })

  // The case SameSite=Lax cookies do NOT stop: a sibling subdomain is "same-site".
  it('blocks a same-site sibling subdomain', () => {
    expect(isCrossOriginUnsafeRequest(mkEvent('POST', { ...COOKIE, 'sec-fetch-site': 'same-site' }))).toBe(true)
  })

  it('blocks cross-site requests', () => {
    expect(isCrossOriginUnsafeRequest(mkEvent('DELETE', { ...COOKIE, 'sec-fetch-site': 'cross-site' }))).toBe(true)
  })

  describe('Origin fallback (no Sec-Fetch-Site header)', () => {
    it('allows a matching Origin', () => {
      expect(isCrossOriginUnsafeRequest(mkEvent('POST', { ...COOKIE, origin: 'https://site-a.example.com' }))).toBe(false)
    })

    it('blocks a different Origin, including a sibling subdomain', () => {
      expect(isCrossOriginUnsafeRequest(mkEvent('POST', { ...COOKIE, origin: 'https://site-b.example.com' }))).toBe(true)
    })

    it('blocks an opaque ("null") Origin', () => {
      expect(isCrossOriginUnsafeRequest(mkEvent('POST', { ...COOKIE, origin: 'null' }))).toBe(true)
    })

    it('blocks a malformed Origin', () => {
      expect(isCrossOriginUnsafeRequest(mkEvent('POST', { ...COOKIE, origin: 'not a url' }))).toBe(true)
    })

    it('allows a request with no Origin at all (non-browser client)', () => {
      expect(isCrossOriginUnsafeRequest(mkEvent('POST', COOKIE))).toBe(false)
    })
  })
})

describe('confinePluginResponseHeaders', () => {
  it('drops cookie-setting headers a plugin could use against the site origin', () => {
    const upstream = new Headers({ 'set-cookie': 'better-auth.session_token=attacker', 'clear-site-data': '"cookies"' })
    const out = confinePluginResponseHeaders(upstream)
    expect(out.get('set-cookie')).toBeNull()
    expect(out.get('clear-site-data')).toBeNull()
  })

  it('forces an opaque-origin sandbox and nosniff, overriding anything the plugin set', () => {
    const upstream = new Headers({
      'content-type': 'text/html',
      'content-security-policy': "default-src *; script-src 'unsafe-inline'",
    })
    const out = confinePluginResponseHeaders(upstream)
    expect(out.get('content-security-policy')).toBe("sandbox; default-src 'none'")
    expect(out.get('x-content-type-options')).toBe('nosniff')
  })

  it('keeps the plugin\'s own content type and body-describing headers', () => {
    const out = confinePluginResponseHeaders(new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' }))
    expect(out.get('content-type')).toBe('application/json')
    expect(out.get('cache-control')).toBe('no-store')
    expect(out.get('access-control-allow-origin')).toBe('*')
  })
})
