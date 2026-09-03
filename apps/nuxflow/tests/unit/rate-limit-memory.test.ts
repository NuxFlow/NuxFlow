import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import { rateLimit } from '../../server/utils/rate-limit'

// --- mocks set up before any module import ---

;(globalThis as Record<string, unknown>).createError = (opts: { statusCode?: number; message?: string; data?: unknown }) => {
  const err = new Error(opts.message ?? 'Error') as Error & { statusCode: number; data: unknown }
  err.statusCode = opts.statusCode ?? 500
  err.data = opts.data
  return err
}
;(globalThis as Record<string, unknown>).getHeader = (_: unknown, __: string): string | null => null

// rate-limit.ts now does a single atomic `db.get(sql\`INSERT ... ON CONFLICT ... RETURNING\`)`
// call instead of a separate read-then-write — mock just that one entry point.
// NOTE: useDb in rate-limit.ts is a Nuxt auto-import (not an explicit named import),
// so we must set it on globalThis rather than using vi.mock.
const mockGet = vi.fn()
;(globalThis as Record<string, unknown>).useDb = () => ({ get: mockGet })

function mkEvent(ip = '127.0.0.1') {
  return {
    context: { siteId: 'site-rl-test' },
    _headers: { 'x-forwarded-for': ip },
  } as unknown as H3Event
}

function farFutureResetAt() {
  return new Date(Date.now() + 60_000).toISOString()
}

describe('rateLimit', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('allows a request within the limit', async () => {
    mockGet.mockResolvedValueOnce({ count: 1, reset_at: farFutureResetAt() })
    await expect(rateLimit(mkEvent('10.0.0.1'), { limit: 5, windowMs: 60_000, keyPrefix: 'unit-a' }))
      .resolves.toBeUndefined()
  })

  it('allows exactly N requests before blocking, then throws 429 on the N+1th', async () => {
    const ip = '10.0.0.2'
    const opts = { limit: 3, windowMs: 60_000, keyPrefix: 'unit-b' }
    const resetAt = farFutureResetAt()

    mockGet
      .mockResolvedValueOnce({ count: 1, reset_at: resetAt })
      .mockResolvedValueOnce({ count: 2, reset_at: resetAt })
      .mockResolvedValueOnce({ count: 3, reset_at: resetAt })

    for (let i = 0; i < 3; i++) {
      await expect(rateLimit(mkEvent(ip), opts)).resolves.toBeUndefined()
    }

    mockGet.mockResolvedValueOnce({ count: 4, reset_at: resetAt })
    await expect(rateLimit(mkEvent(ip), opts)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('rejects with retryAfter data attached to the error', async () => {
    mockGet.mockResolvedValueOnce({ count: 2, reset_at: farFutureResetAt() })

    await rateLimit(mkEvent('10.0.0.4'), { limit: 1, windowMs: 60_000, keyPrefix: 'unit-d' }).catch((err) => {
      expect(err.statusCode).toBe(429)
      expect(err.data).toHaveProperty('retryAfter')
      expect(typeof err.data.retryAfter).toBe('number')
    })
  })

  it('fast-rejects from the isolate-local blocked cache without a second D1 call once blocked', async () => {
    const ip = '10.0.0.5'
    const opts = { limit: 1, windowMs: 60_000, keyPrefix: 'unit-e' }

    mockGet.mockResolvedValueOnce({ count: 2, reset_at: farFutureResetAt() })
    await expect(rateLimit(mkEvent(ip), opts)).rejects.toMatchObject({ statusCode: 429 })

    mockGet.mockClear()
    await expect(rateLimit(mkEvent(ip), opts)).rejects.toMatchObject({ statusCode: 429 })
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('different keys (site/IP/prefix) are tracked independently', async () => {
    mockGet.mockResolvedValueOnce({ count: 1, reset_at: farFutureResetAt() })
    await expect(rateLimit(mkEvent('10.0.0.6'), { limit: 1, windowMs: 60_000, keyPrefix: 'unit-f' }))
      .resolves.toBeUndefined()

    mockGet.mockResolvedValueOnce({ count: 1, reset_at: farFutureResetAt() })
    await expect(rateLimit(mkEvent('10.0.0.7'), { limit: 1, windowMs: 60_000, keyPrefix: 'unit-f' }))
      .resolves.toBeUndefined()
  })
})
