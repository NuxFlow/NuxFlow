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

type MiddlewareFn = (e: H3Event) => Promise<unknown>

function mkEvent(opts: {
  method?: string
  path?: string
  cookies?: Record<string, string>
  noCloudflareContext?: boolean
} = {}) {
  const url = `https://example.com${opts.path ?? '/about'}`
  const cloudflare = opts.noCloudflareContext
    ? undefined
    : { request: new Request(url), env: {} as never, ctx: { waitUntil: vi.fn() } }

  return {
    method: opts.method ?? 'GET',
    context: { cloudflare },
    _path: opts.path ?? '/about',
    _headers: { host: 'example.com' },
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
