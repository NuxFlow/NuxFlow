import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// purgeAllPublicPages queries contentItems via an explicit `useDb` import (unlike the rest
// of this file's functions, which touch only the Cache API) — mocked here so its tests
// don't need a real D1/libSQL database, just a controllable list of "published" rows.
const findManyMock = vi.fn()
vi.mock('../../server/utils/db', () => ({
  useDb: () => ({ query: { contentItems: { findMany: findManyMock } } }),
}))

const { withEdgeCache, purgeContentCache, purgeAllPublicPages } = await import('../../server/utils/edge-cache')

// getRequestURL is a Nitro/H3 auto-import in real server code (see e.g.
// theme-resolver.ts, which calls it with no explicit import) — not a Node/Vitest global,
// so it must be stubbed here. Only needs to exist before withEdgeCache is actually
// *called* (inside test bodies below), not before it's imported, since edge-cache.ts only
// calls getRequestURL from within the function body. Reads off the mock event's own
// cloudflare.request.url so it reflects whatever URL each test's mkEvent() sets up,
// matching how withEdgeCache derives its cache key from "this event's own" URL rather
// than trusting event.context.cloudflare.request verbatim (see edge-cache.ts's own
// comment on why that distinction matters for nested/internal dispatches).
;(globalThis as Record<string, unknown>).getRequestURL = (event: H3Event) => {
  const req = (event.context as { cloudflare?: { request?: Request } }).cloudflare?.request
  return new URL(req?.url ?? 'https://example.com/')
}

// The Cache API (`caches.default`) only exists in the real Cloudflare Workers runtime —
// it's not a Node global, so it must be mocked here. This is exactly the gap that let a
// production-only bug through: the integration/unit harness never populates
// event.context.cloudflare, so withEdgeCache's "no cloudflare context" fallback was the
// only path ever exercised before this file existed — the actual caches.default
// interaction, and any throw inside it, was untested.

function mkEvent(overrides: { noCloudflareContext?: boolean; waitUntil?: ((p: Promise<unknown>) => void) | null } = {}) {
  const cloudflare = overrides.noCloudflareContext
    ? undefined
    : {
        request: new Request('https://example.com/api/public/site'),
        env: {} as never,
        ctx: overrides.waitUntil === null ? undefined : { waitUntil: overrides.waitUntil ?? vi.fn() },
      }
  return { context: { cloudflare } } as unknown as H3Event
}

describe('withEdgeCache', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('computes directly when event.context.cloudflare is absent (test/non-Workers environment)', async () => {
    const event = mkEvent({ noCloudflareContext: true })
    const compute = vi.fn().mockResolvedValue({ ok: true })

    const result = await withEdgeCache(event, 60, compute)

    expect(result).toEqual({ ok: true })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('computes and stores on a cache miss, and still returns the computed value', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const match = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match, put } })

    const waitUntil = vi.fn()
    const event = mkEvent({ waitUntil })
    const compute = vi.fn().mockResolvedValue({ posts: [1, 2, 3] })

    const result = await withEdgeCache(event, 60, compute)

    expect(result).toEqual({ posts: [1, 2, 3] })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('returns the cached value on a hit without calling compute()', async () => {
    const cachedResponse = new Response(JSON.stringify({ cached: true }))
    const match = vi.fn().mockResolvedValue(cachedResponse)
    const put = vi.fn()
    vi.stubGlobal('caches', { default: { match, put } })

    const event = mkEvent()
    const compute = vi.fn().mockResolvedValue({ cached: false })

    const result = await withEdgeCache(event, 60, compute)

    expect(result).toEqual({ cached: true })
    expect(compute).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  // Regression: a production incident where every route using withEdgeCache 500'd,
  // while routes bypassing it worked fine — root-caused to an unguarded throw inside
  // the Cache API interaction taking down the whole request. A caching layer must
  // never be able to break the request it's optimizing.
  it('falls back to compute() when cache.match() throws', async () => {
    const match = vi.fn().mockRejectedValue(new Error('cache.match blew up'))
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match, put } })

    const event = mkEvent()
    const compute = vi.fn().mockResolvedValue({ ok: true })

    await expect(withEdgeCache(event, 60, compute)).resolves.toEqual({ ok: true })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('still returns computed data when cache.put() throws synchronously', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    const put = vi.fn().mockImplementation(() => { throw new Error('put blew up') })
    vi.stubGlobal('caches', { default: { match, put } })

    const event = mkEvent()
    const compute = vi.fn().mockResolvedValue({ ok: true })

    await expect(withEdgeCache(event, 60, compute)).resolves.toEqual({ ok: true })
  })

  it('still returns computed data when cache.put() rejects asynchronously', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    const put = vi.fn().mockRejectedValue(new Error('put rejected'))
    vi.stubGlobal('caches', { default: { match, put } })

    const event = mkEvent()
    const compute = vi.fn().mockResolvedValue({ ok: true })

    await expect(withEdgeCache(event, 60, compute)).resolves.toEqual({ ok: true })
  })

  it('still returns computed data when ctx.waitUntil is missing entirely', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match, put } })

    const event = mkEvent({ waitUntil: null })
    const compute = vi.fn().mockResolvedValue({ ok: true })

    await expect(withEdgeCache(event, 60, compute)).resolves.toEqual({ ok: true })
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('still returns computed data when ctx.waitUntil itself throws synchronously', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match, put } })

    const waitUntil = vi.fn().mockImplementation(() => { throw new Error('waitUntil blew up') })
    const event = mkEvent({ waitUntil })
    const compute = vi.fn().mockResolvedValue({ ok: true })

    await expect(withEdgeCache(event, 60, compute)).resolves.toEqual({ ok: true })
  })

  it('never caches a thrown error from compute()', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match, put } })

    const event = mkEvent()
    const compute = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }))

    await expect(withEdgeCache(event, 60, compute)).rejects.toMatchObject({ statusCode: 404 })
    expect(put).not.toHaveBeenCalled()
  })
})

describe('purgeContentCache', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('purges both the JSON path and the rendered page path for each slug', async () => {
    const del = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('caches', { default: { delete: del } })

    const event = mkEvent()
    await purgeContentCache(event, { slugs: ['about'] })

    const purged = del.mock.calls.map(([req]: [Request]) => new URL(req.url).pathname)
    expect(purged).toContain('/api/public/pages/about')
    expect(purged).toContain('/about')
  })

  // The homepage content item's slug is literally 'home', but app/pages/index.vue
  // hardcodes fetching it at the site root — the rendered page (and therefore its
  // page-cache entry) lives at '/', not '/home'. Purging the wrong path would leave
  // the actual homepage's stale cache entry untouched after every edit.
  it('purges "/" (not "/home") for a content item whose slug is "home"', async () => {
    const del = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('caches', { default: { delete: del } })

    const event = mkEvent()
    await purgeContentCache(event, { slugs: ['home'] })

    const purged = del.mock.calls.map(([req]: [Request]) => new URL(req.url).pathname)
    expect(purged).toContain('/')
    expect(purged).not.toContain('/home')
  })

  it('purges both the JSON and page path for each tagged taxonomy term', async () => {
    const del = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('caches', { default: { delete: del } })

    const event = mkEvent()
    await purgeContentCache(event, {
      slugs: [],
      taxonomyTerms: [{ taxonomySlug: 'category', termSlug: 'news' }],
    })

    const purged = del.mock.calls.map(([req]: [Request]) => new URL(req.url).pathname)
    expect(purged).toContain('/api/public/taxonomy/category/news')
    expect(purged).toContain('/category/news')
  })
})

describe('purgeAllPublicPages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    findManyMock.mockReset()
  })

  it('purges every published, public content item\'s page path plus "/"', async () => {
    findManyMock.mockResolvedValue([{ slug: 'about' }, { slug: 'pricing' }, { slug: 'home' }])
    const del = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('caches', { default: { delete: del } })

    const event = mkEvent()
    await purgeAllPublicPages(event, 'site-1')

    const purged = del.mock.calls.map(([req]: [Request]) => new URL(req.url).pathname)
    expect(purged).toContain('/about')
    expect(purged).toContain('/pricing')
    expect(purged).toContain('/') // both the explicit root purge and 'home''s mapped path
    expect(purged).not.toContain('/home')
  })

  it('is a no-op when there is no Cloudflare context (never queries the DB)', async () => {
    const event = mkEvent({ noCloudflareContext: true })
    await purgeAllPublicPages(event, 'site-1')
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('does not throw when the underlying purge fails', async () => {
    findManyMock.mockResolvedValue([{ slug: 'about' }])
    vi.stubGlobal('caches', { default: { delete: vi.fn().mockRejectedValue(new Error('boom')) } })

    await expect(purgeAllPublicPages(mkEvent(), 'site-1')).resolves.toBeUndefined()
  })
})
