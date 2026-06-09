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

// cf-env: return no KV so execution falls through to the DB tier
vi.mock('../../server/utils/cf-env', () => ({
  getCfBindings: () => ({ kv: null, loader: null }),
}))

// DB: return a no-op implementation sufficient for tier-3 path.
// NOTE: useDb in rate-limit.ts is a Nuxt auto-import (not an explicit named import),
// so we must set it on globalThis rather than using vi.mock.
const mockFindFirst = vi.fn()
const mockInsertValues = vi.fn().mockResolvedValue(undefined)
const mockUpdateSet = vi.fn()
const mockUpdateSetWhere = vi.fn().mockResolvedValue(undefined)
mockUpdateSet.mockReturnValue({ where: mockUpdateSetWhere })

;(globalThis as Record<string, unknown>).useDb = () => ({
  query: { rateLimits: { findFirst: mockFindFirst } },
  insert: () => ({ values: mockInsertValues }),
  update: () => ({ set: mockUpdateSet }),
})

function mkEvent(ip = '127.0.0.1') {
  return {
    context: { siteId: 'site-rl-test' },
    _headers: { 'x-forwarded-for': ip },
  } as unknown as H3Event
}

describe('rateLimit — memory tier', () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue(null)
    mockInsertValues.mockResolvedValue(undefined)
    mockUpdateSet.mockReturnValue({ where: mockUpdateSetWhere })
    mockUpdateSetWhere.mockResolvedValue(undefined)
    vi.clearAllMocks()
    mockFindFirst.mockResolvedValue(null)
    mockInsertValues.mockResolvedValue(undefined)
    mockUpdateSet.mockReturnValue({ where: mockUpdateSetWhere })
    mockUpdateSetWhere.mockResolvedValue(undefined)
  })

  it('allows a request within the limit', async () => {
    const event = mkEvent('10.0.0.1')
    await expect(rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'unit-a' })).resolves.toBeUndefined()
  })

  it('allows exactly N requests before blocking', async () => {
    const ip = '10.0.0.2'
    const opts = { limit: 3, windowMs: 60_000, keyPrefix: 'unit-b' }

    for (let i = 0; i < 3; i++) {
      await expect(rateLimit(mkEvent(ip), opts)).resolves.toBeUndefined()
    }
  })

  it('throws 429 after the limit is exceeded in memory', async () => {
    // The memory cache throws when cached.count > limit, so with limit=1:
    //  call 1 → cache miss → count=1
    //  call 2 → count=1, 1>1 is false → count→2, DB runs (no-op)
    //  call 3 → count=2, 2>1 is true  → THROW 429
    const ip = '10.0.0.3'
    const opts = { limit: 1, windowMs: 60_000, keyPrefix: 'unit-c' }

    await rateLimit(mkEvent(ip), opts)
    await rateLimit(mkEvent(ip), opts)

    await expect(rateLimit(mkEvent(ip), opts)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('rejects with retryAfter data attached to the error', async () => {
    const ip = '10.0.0.4'
    const opts = { limit: 1, windowMs: 60_000, keyPrefix: 'unit-d' }

    await rateLimit(mkEvent(ip), opts)
    await rateLimit(mkEvent(ip), opts)

    await rateLimit(mkEvent(ip), opts).catch(err => {
      expect(err.statusCode).toBe(429)
      expect(err.data).toHaveProperty('retryAfter')
      expect(typeof err.data.retryAfter).toBe('number')
    })
  })
})
