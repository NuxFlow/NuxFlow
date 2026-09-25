import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).createError) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).createError = (err: { statusCode: number; message: string }) => Object.assign(new Error(err.message), err)
}

const settings = new Map<string, string>()
vi.mock('../../server/utils/settings', () => ({
  resolveSetting: vi.fn((_event: unknown, key: string) => Promise.resolve(settings.get(key) ?? '')),
}))

// getCfBindings caches bindings at module level once it has seen them, so the binding is
// controlled through a mock here rather than per-event context.
let bucket: R2Bucket | null = null
vi.mock('../../server/utils/cf-env', () => ({
  getCfBindings: () => ({ r2: bucket, kv: null, loader: null }),
}))

const { getActiveProvider } = await import('../../server/utils/media-providers/index')
const { R2Provider } = await import('../../server/utils/media-providers/r2')
const { absoluteUrl, absolutizeHtmlUrls, WORKER_MEDIA_PREFIX } = await import('../../server/utils/media-url')

const fakeBucket = { put: vi.fn(), delete: vi.fn(), head: vi.fn() } as unknown as R2Bucket
const mkEvent = () => ({}) as H3Event

beforeEach(() => {
  settings.clear()
  bucket = null
})

describe('getActiveProvider — zero-config R2', () => {
  // The bucket binding alone is real storage now: no public URL needed, so an operator
  // who bound the bucket never silently lands on the database fallback.
  it('uses R2 served through the Worker when only the bucket binding exists', async () => {
    bucket = fakeBucket
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('r2')
    expect(provider.getUrl('site-1/01ABC.png')).toBe(`${WORKER_MEDIA_PREFIX}site-1/01ABC.png`)
  })

  it('uses the public URL when one is configured', async () => {
    bucket = fakeBucket
    settings.set('media.r2_public_url', 'https://media.example.com/')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.getUrl('site-1/01ABC.png')).toBe('https://media.example.com/site-1/01ABC.png')
  })

  // Explicitly configured providers keep their existing priority: adding the bucket
  // binding must not silently move an S3/Bunny site onto R2.
  it('keeps an explicitly configured S3 or Bunny provider ahead of binding-only R2', async () => {
    bucket = fakeBucket
    settings.set('media.s3_bucket', 'my-bucket')
    expect((await getActiveProvider(mkEvent())).name).toBe('s3')
    settings.clear()
    settings.set('media.bunny_api_key', 'k')
    expect((await getActiveProvider(mkEvent())).name).toBe('bunny')
  })

  it('still prefers R2 with a public URL over S3, as before', async () => {
    bucket = fakeBucket
    settings.set('media.r2_public_url', 'https://media.example.com')
    settings.set('media.s3_bucket', 'my-bucket')
    expect((await getActiveProvider(mkEvent())).name).toBe('r2')
  })

  it('falls back to the database only when no bucket and nothing configured', async () => {
    expect((await getActiveProvider(mkEvent())).name).toBe('local')
  })
})

describe('R2Provider', () => {
  it('reports whether it is served through the Worker', () => {
    expect(new R2Provider({ bucket: fakeBucket }).servedByWorker).toBe(true)
    expect(new R2Provider({ bucket: fakeBucket, publicUrl: 'https://m.example.com' }).servedByWorker).toBe(false)
  })

  it('checks object existence with head()', async () => {
    const head = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(null)
    const provider = new R2Provider({ bucket: { head } as unknown as R2Bucket })
    expect(await provider.exists('a/b.png')).toBe(true)
    expect(await provider.exists('a/c.png')).toBe(false)
  })
})

describe('media URL helpers', () => {
  it('makes site-relative URLs absolute and leaves others alone', () => {
    expect(absoluteUrl('/_nuxflow/media/s/x.png', 'https://site.test/')).toBe('https://site.test/_nuxflow/media/s/x.png')
    expect(absoluteUrl('https://cdn.test/x.png', 'https://site.test')).toBe('https://cdn.test/x.png')
    expect(absoluteUrl('//cdn.test/x.png', 'https://site.test')).toBe('//cdn.test/x.png')
    expect(absoluteUrl('data:image/png;base64,AA', 'https://site.test')).toBe('data:image/png;base64,AA')
  })

  it('absolutizes relative src/href attributes in feed HTML', () => {
    const html = '<p><img src="/_nuxflow/media/s/x.png"><a href="/about">a</a><a href="https://x.test/">b</a><img src="//cdn/x"></p>'
    expect(absolutizeHtmlUrls(html, 'https://site.test')).toBe(
      '<p><img src="https://site.test/_nuxflow/media/s/x.png"><a href="https://site.test/about">a</a><a href="https://x.test/">b</a><img src="//cdn/x"></p>',
    )
  })
})
