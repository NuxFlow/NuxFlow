import { describe, it, expect, vi } from 'vitest'
import type { H3Event } from 'h3'
import { createMockEvent } from '../helpers/event'

// A small in-memory stand-in for an R2Bucket's get(): honours If-None-Match (returning an
// object with no body, as R2 does for a failed precondition) and simple byte ranges.
const objects = new Map<string, { bytes: Uint8Array; type: string; disposition?: string }>()
const fakeBucket = {
  async get(key: string, opts: { onlyIf?: Headers; range?: Headers }) {
    const obj = objects.get(key)
    if (!obj) return null
    const etag = `"etag-${key}"`
    const base = {
      size: obj.bytes.byteLength,
      httpEtag: etag,
      writeHttpMetadata(h: Headers) {
        h.set('Content-Type', obj.type)
        if (obj.disposition) h.set('Content-Disposition', obj.disposition)
      },
    }
    if (opts.onlyIf?.get('if-none-match') === etag) return base
    const rangeHeader = opts.range?.get('range')
    const m = rangeHeader ? /bytes=(\d+)-(\d+)/.exec(rangeHeader) : null
    if (m) {
      const offset = Number(m[1]); const length = Number(m[2]) - offset + 1
      return { ...base, range: { offset, length }, body: new Blob([obj.bytes.slice(offset, offset + length)]).stream() }
    }
    return { ...base, body: new Blob([obj.bytes]).stream() }
  },
}
vi.mock('../../server/utils/cf-env', () => ({
  getCfBindings: () => ({ r2: fakeBucket, kv: null, loader: null }),
}))

const { default: mediaRoute } = await import('../../server/routes/_nuxflow/media/[...key]')

const SITE = 'site-media-route'
const UPLOAD_KEY = `${SITE}/01J0000000000000000000000A.png`
objects.set(UPLOAD_KEY, { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), type: 'image/png' })
objects.set(`${SITE}/themes/t1/shot.svg`, { bytes: new TextEncoder().encode('<svg/>'), type: 'image/svg+xml', disposition: 'attachment' })
objects.set('other-site/01J0000000000000000000000B.png', { bytes: new Uint8Array([9]), type: 'image/png' })

type Handler = (e: H3Event) => Promise<Response>

function request(key: string, opts: { method?: string; headers?: Record<string, string>; siteId?: string } = {}) {
  const event = createMockEvent({ siteId: opts.siteId ?? SITE, params: { key }, headers: opts.headers ?? {}, method: opts.method ?? 'GET' })
  return (mediaRoute as Handler)(Object.assign(event, { method: opts.method ?? 'GET' }) as unknown as H3Event)
}

describe('GET /_nuxflow/media/** (zero-config R2 serving)', () => {
  it('serves an object with its content type, a long cache for upload keys, and lock-down headers', async () => {
    const res = await request(UPLOAD_KEY)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(res.headers.get('content-security-policy')).toMatch(/^sandbox/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
  })

  it('gives overwritable keys (theme assets) only a short cache, and keeps SVGs as attachments', async () => {
    const res = await request(`${SITE}/themes/t1/shot.svg`)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect(res.headers.get('content-disposition')).toBe('attachment')
  })

  it('answers a matching If-None-Match with 304', async () => {
    const res = await request(UPLOAD_KEY, { headers: { 'if-none-match': `"etag-${UPLOAD_KEY}"` } })
    expect(res.status).toBe(304)
    expect(res.body).toBeNull()
  })

  it('serves byte ranges with 206 and Content-Range', async () => {
    const res = await request(UPLOAD_KEY, { headers: { range: 'bytes=2-4' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([3, 4, 5]))
  })

  // Each site's domain only ever serves that site's own objects.
  it('refuses another site\'s objects', async () => {
    await expect(request('other-site/01J0000000000000000000000B.png')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses traversal-shaped and empty-segment keys', async () => {
    for (const key of [`${SITE}/../other-site/x.png`, `${SITE}//x.png`, `${SITE}/./x.png`, `${SITE}/%2e%2e/x.png`]) {
      await expect(request(key)).rejects.toMatchObject({ statusCode: 404 })
    }
  })

  it('404s a missing object and rejects non-GET/HEAD methods', async () => {
    await expect(request(`${SITE}/01J0000000000000000000000Z.png`)).rejects.toMatchObject({ statusCode: 404 })
    await expect(request(UPLOAD_KEY, { method: 'POST' })).rejects.toMatchObject({ statusCode: 405 })
  })

  it('answers HEAD without a body', async () => {
    const res = await request(UPLOAD_KEY, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
    expect(res.headers.get('content-length')).toBe('10')
  })
})
