/**
 * Integration tests for server/middleware/07.page-cache.ts — the read side of the
 * full-page edge cache (see server/utils/page-cache.ts for the eligibility rules and
 * server/plugins/page-cache.ts for the write side).
 *
 * Builds its own Cloudflare-context-aware mock event rather than reusing
 * createMockEvent/mkSiteEvent from the other middleware tests, since none of those were
 * built with event.context.cloudflare (needed to exercise the actual Cache API path) in
 * mind — this mirrors the same mkEvent() pattern tests/unit/edge-cache.test.ts already
 * uses for the JSON-layer cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import pageCacheMiddleware from '../../server/middleware/07.page-cache'

globalThis.defineNitroPlugin = ((fn: unknown) => fn) as never
const { default: pageCachePlugin } = await import('../../server/plugins/page-cache')

type RenderResponse = { body: unknown; statusCode?: number; headers?: Record<string, string> }
type RenderResponseHook = (response: RenderResponse, ctx: { event: H3Event }) => Promise<void>
let renderResponse: RenderResponseHook | undefined
;(pageCachePlugin as unknown as (nitro: unknown) => void)({
  hooks: { hook: (name: string, fn: RenderResponseHook) => { if (name === 'render:response') renderResponse = fn } },
})

type MiddlewareFn = (e: H3Event) => Promise<unknown>

function mkEvent(opts: {
  method?: string
  path?: string
  cookies?: Record<string, string>
  headers?: Record<string, string>
  noCloudflareContext?: boolean
} = {}) {
  const url = `https://example.com${opts.path ?? '/about'}`
  const cloudflare = opts.noCloudflareContext
    ? undefined
    : { request: new Request(url), env: {} as never, context: { waitUntil: vi.fn() } }

  return {
    method: opts.method ?? 'GET',
    context: { cloudflare },
    _path: opts.path ?? '/about',
    _headers: { host: 'example.com', ...opts.headers },
    _cookies: opts.cookies ?? {},
    _responseHeaders: {} as Record<string, string>,
    _status: undefined as number | undefined,
  } as unknown as H3Event
}

describe('07.page-cache middleware (read side)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing for an ineligible request (e.g. /admin) — never touches the cache', async () => {
    const match = vi.fn()
    vi.stubGlobal('caches', { default: { match } })

    const event = mkEvent({ path: '/admin/settings' })
    const result = await (pageCacheMiddleware as MiddlewareFn)(event)

    expect(result).toBeUndefined()
    expect(match).not.toHaveBeenCalled()
  })

  it('falls through (returns undefined) on a cache miss', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match } })

    const event = mkEvent()
    const result = await (pageCacheMiddleware as MiddlewareFn)(event)

    expect(result).toBeUndefined()
    expect(match).toHaveBeenCalledTimes(1)
  })

  it('short-circuits with the cached body and headers on a cache hit', async () => {
    const cached = new Response('<html>cached page</html>', {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    })
    const match = vi.fn().mockResolvedValue(cached)
    vi.stubGlobal('caches', { default: { match } })

    const event = mkEvent() as unknown as { _responseHeaders: Record<string, string>; _status?: number }
    const result = await (pageCacheMiddleware as MiddlewareFn)(event as unknown as H3Event)

    expect(result).toBe('<html>cached page</html>')
    expect(event._status).toBe(200)
    expect(event._responseHeaders['Content-Type']).toBe('text/html; charset=utf-8')
    expect(event._responseHeaders['X-NuxFlow-Page-Cache']).toBe('HIT')
    // Browsers must not keep their own copy — an edit has to show on the next visit.
    expect(event._responseHeaders['Cache-Control']).toBe('no-cache')
  })

  // A click from an ad or social post carries a unique click id. The cache key ignores it,
  // so the click shares one entry with the plain URL instead of always rendering afresh.
  it('ignores tracking parameters in the lookup key but keeps real ones', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match } })

    await (pageCacheMiddleware as MiddlewareFn)(mkEvent({ path: '/about?utm_source=fb&page=2&fbclid=IwAR123' }))

    expect((match.mock.calls[0]![0] as Request).url).toMatch(/\/\/example\.com\/about\?page=2&__nfv=u&__nfc=cp\.[^.&]+\.0$/)
  })

  it('looks up the region-specific variant for a visitor in a consent-required region', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match } })

    await (pageCacheMiddleware as MiddlewareFn)(mkEvent({ headers: { 'cf-ipcountry': 'NL' } }))

    expect((match.mock.calls[0]![0] as Request).url).toMatch(/\/\/example\.com\/about\?__nfv=r&__nfc=cp\.[^.&]+\.0$/)
  })

  it('still serves the cache to a visitor carrying only analytics/consent cookies', async () => {
    const match = vi.fn().mockResolvedValue(new Response('<html>cached</html>', { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('caches', { default: { match } })

    const result = await (pageCacheMiddleware as MiddlewareFn)(mkEvent({ cookies: { _ga: 'GA1.1', nuxflow_consent: '%7B%7D' } }))

    expect(result).toBe('<html>cached</html>')
  })

  it('falls through gracefully when cache.match() throws', async () => {
    const match = vi.fn().mockRejectedValue(new Error('cache.match blew up'))
    vi.stubGlobal('caches', { default: { match } })

    const event = mkEvent()
    await expect((pageCacheMiddleware as MiddlewareFn)(event)).resolves.toBeUndefined()
  })

  it('does nothing when there is no Cloudflare context (test/non-Workers environment)', async () => {
    const match = vi.fn()
    vi.stubGlobal('caches', { default: { match } })

    const event = mkEvent({ noCloudflareContext: true })
    const result = await (pageCacheMiddleware as MiddlewareFn)(event)

    expect(result).toBeUndefined()
    expect(match).not.toHaveBeenCalled()
  })
})

describe('page-cache plugin (write side)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  // As the read side leaves it: 07.page-cache.ts records the cache version it looked up.
  function htmlEvent(opts: Parameters<typeof mkEvent>[0] = {}) {
    const event = mkEvent(opts) as unknown as { _responseHeaders: Record<string, string>; context: Record<string, unknown> }
    event._responseHeaders['content-type'] = 'text/html;charset=utf-8'
    event.context.pageCacheVersion = '0'
    return event as unknown as H3Event
  }

  async function cachedBody(put: ReturnType<typeof vi.fn>): Promise<string> {
    return (put.mock.calls[0]![1] as Response).text()
  }

  // Nuxt 4.6+: the renderer hands Nitro a ReadableStream, with headers already set on the
  // event rather than listed on the response. Requiring a string body silently disabled
  // the page cache for every page after that upgrade.
  it('caches a streamed body and still sends the full page to the visitor', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { put } })

    const response: RenderResponse = { body: new Response('<html>streamed</html>').body, statusCode: 200 }
    const event = htmlEvent()
    await renderResponse!(response, { event })

    expect(put).toHaveBeenCalledTimes(1)
    expect((put.mock.calls[0]![0] as Request).url).toMatch(/\/about\?__nfv=u&__nfc=0$/)
    expect(await cachedBody(put)).toBe('<html>streamed</html>')
    expect(await new Response(response.body as ReadableStream).text()).toBe('<html>streamed</html>')
    expect((event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['Cache-Control']).toBe('no-cache')
  })

  it('caches a string body (older Nuxt shape)', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { put } })

    const event = mkEvent() as unknown as { context: Record<string, unknown> }
    event.context.pageCacheVersion = '0'
    await renderResponse!({ body: '<html>s</html>', statusCode: 200, headers: { 'content-type': 'text/html' } }, { event: event as unknown as H3Event })

    expect(await cachedBody(put)).toBe('<html>s</html>')
  })

  it('caches under the clean URL and region variant the read side looks up', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match, put } })

    const event = htmlEvent({ path: '/about?fbclid=x', headers: { 'cf-ipcountry': 'SE' } })
    await (pageCacheMiddleware as MiddlewareFn)(event)
    await renderResponse!({ body: '<html>x</html>', statusCode: 200 }, { event })

    expect((put.mock.calls[0]![0] as Request).url).toBe((match.mock.calls[0]![0] as Request).url)
  })

  // A page that started rendering before an edit bumped the version must not be saved
  // under the new one — the write side only uses what the read side looked up.
  it('does not cache a render whose read side never recorded a cache version', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { put } })

    const event = mkEvent() as unknown as { _responseHeaders: Record<string, string> }
    event._responseHeaders['content-type'] = 'text/html'
    await renderResponse!({ body: '<html>x</html>', statusCode: 200 }, { event: event as unknown as H3Event })

    expect(put).not.toHaveBeenCalled()
  })

  it('never caches a non-200 response, a non-HTML response, or a signed-in request', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { put } })

    await renderResponse!({ body: '<html>404</html>', statusCode: 404 }, { event: htmlEvent() })
    await renderResponse!({ body: '{}', statusCode: 200, headers: { 'content-type': 'application/json' } }, { event: mkEvent() })
    await renderResponse!({ body: '<html>me</html>', statusCode: 200 }, { event: htmlEvent({ cookies: { 'better-auth.session_token': 'x' } }) })

    expect(put).not.toHaveBeenCalled()
  })
})
