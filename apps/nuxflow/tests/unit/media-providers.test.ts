import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import { findMediaProvider, getActiveProvider, hasMediaStorage } from '../../server/utils/media-providers/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).createError) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).createError = (err: { statusCode: number; message: string; data?: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const error = new Error(err.message) as any
    error.statusCode = err.statusCode
    error.data = err.data
    return error
  }
}

const settings = new Map<string, string>()

vi.mock('../../server/utils/settings', () => ({
  resolveSetting: vi.fn((_event: unknown, key: string) => Promise.resolve(settings.get(key) ?? '')),
  resolveStringSetting: vi.fn((_event: unknown, key: string) => Promise.resolve(settings.get(key) ?? '')),
}))

function mkEvent(): H3Event {
  return {} as H3Event
}

beforeEach(() => {
  settings.clear()
})

describe('getActiveProvider — selection priority', () => {
  it('refuses with 409 storage_required when nothing is configured (no database fallback)', async () => {
    await expect(getActiveProvider(mkEvent())).rejects.toMatchObject({ statusCode: 409, data: { code: 'storage_required' } })
    expect(await findMediaProvider(mkEvent())).toBeNull()
    expect(await hasMediaStorage(mkEvent())).toBe(false)
  })

  it('picks Cloudflare Images when account + token + delivery URL are set', async () => {
    settings.set('cloudflare.account_id', 'acct123')
    settings.set('cloudflare.images_token', 'tok123')
    settings.set('cloudflare.images_delivery_url', 'https://imagedelivery.net/abc123')
    const provider = await getActiveProvider(mkEvent())
    expect(provider.name).toBe('cloudflare')
    expect(await hasMediaStorage(mkEvent())).toBe(true)
  })

  it('has no storage when Cloudflare Images is missing its delivery URL and nothing else is configured', async () => {
    settings.set('cloudflare.account_id', 'acct123')
    settings.set('cloudflare.images_token', 'tok123')
    expect(await findMediaProvider(mkEvent())).toBeNull()
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
