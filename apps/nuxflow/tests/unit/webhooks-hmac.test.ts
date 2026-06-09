import { describe, it, expect, vi, afterEach } from 'vitest'
import { dispatchWebhook } from '../../server/utils/webhooks'

// Explicit mock for useDb — dispatchWebhook imports it directly
vi.mock('../../server/utils/db', () => ({
  useDb: () => mockDb,
  getD1: () => null,
}))

// Build a reusable mock DB that we control per-test
const mockDb = {
  query: {
    webhooks: {
      findMany: vi.fn(),
    },
  },
  update: vi.fn(),
}

afterEach(() => {
  vi.clearAllMocks()
})

// Helper — compute HMAC-SHA256 hex the same way the source does
async function expectedHmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
}

describe('dispatchWebhook', () => {
  it('skips dispatch when no webhooks are configured', async () => {
    mockDb.query.webhooks.findMany.mockResolvedValue([])
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    await dispatchWebhook('site-1', 'content.created', { id: 'item-1' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('dispatches to matching event hooks', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({})
    vi.stubGlobal('fetch', fakeFetch)
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    mockDb.query.webhooks.findMany.mockResolvedValue([
      { id: 'hook-1', url: 'https://example.com/hook', events: ['content.created'], secret: null, isActive: true },
    ])

    await dispatchWebhook('site-1', 'content.created', { id: 'item-1' })
    expect(fakeFetch).toHaveBeenCalledOnce()
    const [url, opts] = fakeFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.com/hook')
    expect(opts.method).toBe('POST')
  })

  it('skips hooks for non-matching events', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    mockDb.query.webhooks.findMany.mockResolvedValue([
      { id: 'hook-2', url: 'https://example.com/hook', events: ['content.deleted'], secret: null, isActive: true },
    ])

    await dispatchWebhook('site-1', 'content.created', {})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends wildcard hooks for any event', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({})
    vi.stubGlobal('fetch', fakeFetch)
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    mockDb.query.webhooks.findMany.mockResolvedValue([
      { id: 'hook-3', url: 'https://example.com/hook', events: ['*'], secret: null, isActive: true },
    ])

    await dispatchWebhook('site-1', 'any.event', {})
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it('includes an HMAC signature header when a secret is configured', async () => {
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, opts) => {
      capturedHeaders = (opts as { headers: Record<string, string> }).headers
      return Promise.resolve({})
    }))
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })

    const secret = 'webhook-secret-key'
    const payload = { id: 'item-99' }
    mockDb.query.webhooks.findMany.mockResolvedValue([
      { id: 'hook-4', url: 'https://example.com/hook', events: ['*'], secret, isActive: true },
    ])

    await dispatchWebhook('site-1', 'content.created', payload)

    expect(capturedHeaders['x-nuxflow-signature']).toMatch(/^sha256=[0-9a-f]{64}$/)

    // Verify the HMAC value is correct
    const bodyText = (vi.mocked(globalThis.fetch).mock.calls[0] as [string, { body: string }])[1].body
    const expected = `sha256=${await expectedHmac(secret, bodyText)}`
    expect(capturedHeaders['x-nuxflow-signature']).toBe(expected)
  })
})
