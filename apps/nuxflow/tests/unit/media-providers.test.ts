import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import { getActiveProvider } from '../../server/utils/media-providers/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).createError) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).createError = (err: { statusCode: number; message: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const error = new Error(err.message) as any
    error.statusCode = err.statusCode
    return error
  }
}

const settings = new Map<string, string>()

vi.mock('../../server/utils/settings', () => ({
  resolveSetting: vi.fn((_event: unknown, key: string) => Promise.resolve(settings.get(key) ?? '')),
}))

function mkEvent(): H3Event {
  return {} as H3Event
}

beforeEach(() => {
  settings.clear()
})

describe('getActiveProvider — selection priority', () => {
  it('falls back to the local provider when nothing is configured', async () => {
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('local')
  })

  it('picks Cloudflare Images when account + token + delivery URL are set', async () => {
    settings.set('cloudflare.account_id', 'acct123')
    settings.set('cloudflare.images_token', 'tok123')
    settings.set('cloudflare.images_delivery_url', 'https://imagedelivery.net/abc123')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('cloudflare')
  })

  it('falls through to the next provider when Cloudflare Images is missing its delivery URL', async () => {
    settings.set('cloudflare.account_id', 'acct123')
    settings.set('cloudflare.images_token', 'tok123')
    settings.set('media.s3_bucket', 'my-bucket')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('s3')
  })

  it('falls all the way back to local when Cloudflare Images is missing its delivery URL and nothing else is configured', async () => {
    settings.set('cloudflare.account_id', 'acct123')
    settings.set('cloudflare.images_token', 'tok123')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('local')
  })

  it('picks S3 when Cloudflare Images is not configured', async () => {
    settings.set('media.s3_bucket', 'my-bucket')
    settings.set('media.s3_access_key', 'AKIA')
    settings.set('media.s3_secret_key', 'secret')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('s3')
  })

  it('picks Bunny when neither Cloudflare Images nor S3 are configured', async () => {
    settings.set('media.bunny_api_key', 'bunny-key')
    settings.set('media.bunny_storage_zone', 'zone')
    settings.set('media.bunny_pull_zone', 'pull')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('bunny')
  })

  it('prefers Cloudflare Images over S3 and Bunny when all three are configured', async () => {
    settings.set('cloudflare.account_id', 'acct123')
    settings.set('cloudflare.images_token', 'tok123')
    settings.set('cloudflare.images_delivery_url', 'https://imagedelivery.net/abc123')
    settings.set('media.s3_bucket', 'my-bucket')
    settings.set('media.bunny_api_key', 'bunny-key')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('cloudflare')
  })

  it('prefers S3 over Bunny when both are configured', async () => {
    settings.set('media.s3_bucket', 'my-bucket')
    settings.set('media.bunny_api_key', 'bunny-key')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('s3')
  })
})

describe('local provider — size guard', () => {
  it('accepts a small file', async () => {
    const provider = await getActiveProvider(mkEvent())
    const file = new File([new Uint8Array(1024)], 'small.png', { type: 'image/png' })
    const result = await provider.upload(file, 'small.png', 'site-1')
    expect(result.url).toMatch(/^data:image\/png;base64,/)
  })

  it('rejects a file over the 512 KB cap with a clear 413 error', async () => {
    const provider = await getActiveProvider(mkEvent())
    const file = new File([new Uint8Array(600 * 1024)], 'big.png', { type: 'image/png' })
    await expect(provider.upload(file, 'big.png', 'site-1')).rejects.toMatchObject({ statusCode: 413 })
  })
})

describe('R2 provider — SVG content disposition', () => {
  // SVG is sanitized on upload, and additionally stored as an attachment so opening its
  // URL directly downloads it instead of rendering it (and any script a sanitizer bypass
  // might leave) on the media origin. <img>/CSS embedding ignores Content-Disposition.
  async function putMetadataFor(type: string) {
    const { R2Provider } = await import('../../server/utils/media-providers/r2')
    const put = vi.fn().mockResolvedValue(undefined)
    const provider = new R2Provider({ bucket: { put, delete: vi.fn() } as unknown as R2Bucket, publicUrl: 'https://media.example.com' })
    await provider.upload(new File(['x'], 'f', { type }), 'site/key')
    return put.mock.calls[0]![2].httpMetadata as { contentType: string; contentDisposition?: string }
  }

  it('marks SVG uploads as attachments', async () => {
    expect(await putMetadataFor('image/svg+xml')).toEqual({ contentType: 'image/svg+xml', contentDisposition: 'attachment' })
  })

  it('leaves raster images inline', async () => {
    expect((await putMetadataFor('image/png')).contentDisposition).toBeUndefined()
  })
})
