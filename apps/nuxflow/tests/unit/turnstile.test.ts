import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyTurnstile } from '../../server/utils/turnstile'

describe('verifyTurnstile', () => {
  beforeEach(() => {
    delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns true when the secret key is not configured (dev bypass)', async () => {
    const result = await verifyTurnstile('any-token')
    expect(result).toBe(true)
  })

  it('returns true when Cloudflare returns success: true', async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'test-secret'
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await verifyTurnstile('valid-token', '1.2.3.4')
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('returns false when Cloudflare returns success: false', async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'test-secret'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    }))

    const result = await verifyTurnstile('bad-token')
    expect(result).toBe(false)
  })

  it('sends the token and secret as FormData', async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'my-key'
    let capturedBody: FormData | null = null
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts.body as FormData
      return Promise.resolve({ json: async () => ({ success: true }) })
    }))

    await verifyTurnstile('tok-abc')
    expect(capturedBody).toBeInstanceOf(FormData)
    expect((capturedBody as FormData).get('secret')).toBe('my-key')
    expect((capturedBody as FormData).get('response')).toBe('tok-abc')
  })

  it('includes remoteip in FormData when IP is provided', async () => {
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'key'
    let capturedBody: FormData | null = null
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, opts) => {
      capturedBody = opts.body as FormData
      return Promise.resolve({ json: async () => ({ success: true }) })
    }))

    await verifyTurnstile('tok', '10.0.0.1')
    expect((capturedBody as FormData).get('remoteip')).toBe('10.0.0.1')
  })
})
