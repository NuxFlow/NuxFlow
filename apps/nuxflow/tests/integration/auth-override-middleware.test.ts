import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { createMockEvent } from '../helpers/event'

const rateLimitMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}))

// The middleware hands everything it doesn't reject to Better Auth; a stub handler is
// enough to observe that hand-off without building a real auth instance.
const authHandlerMock = vi.fn().mockResolvedValue('handled-by-better-auth')
;(globalThis as Record<string, unknown>).getOrCreateBetterAuth = async () => ({ handler: authHandlerMock })

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, toWebRequest: () => new Request('http://localhost/') }
})

const { default: middleware } = await import('../../server/middleware/04.auth-override')

type Handler = (e: H3Event) => Promise<unknown>

// Real h3 exposes `event.path` including the query string — the property this middleware
// reads to decide whether it applies at all — while getRequestURL() (stubbed off `_path`)
// gives the parsed URL. Both are set from the same raw path here, as on a real request.
function mkEvent(rawPath: string, method = 'POST') {
  const event = createMockEvent({ path: rawPath, method, headers: { host: 'localhost' } })
  return Object.assign(event, { path: rawPath, method }) as unknown as H3Event
}

beforeEach(() => {
  rateLimitMock.mockClear()
  authHandlerMock.mockClear()
})

describe('04.auth-override middleware', () => {
  it('rate-limits sign-in', async () => {
    await (middleware as Handler)(mkEvent('/api/auth/sign-in/email'))
    expect(rateLimitMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ keyPrefix: 'auth:/api/auth/sign-in/email' }))
  })

  // event.path includes the query string; keying the limit lookup on it let
  // `?anything` skip the limit while Better Auth still processed the sign-in.
  it('still rate-limits sign-in when a query string is appended', async () => {
    await (middleware as Handler)(mkEvent('/api/auth/sign-in/email?bypass=1'))
    expect(rateLimitMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ keyPrefix: 'auth:/api/auth/sign-in/email' }))
  })

  it('still rate-limits password-reset requests with a trailing slash', async () => {
    await (middleware as Handler)(mkEvent('/api/auth/request-password-reset/'))
    expect(rateLimitMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ keyPrefix: 'auth:/api/auth/request-password-reset' }))
  })

  // Better Auth's own sign-up ignores the per-site registration setting; leaving it open
  // let anyone pre-register an address before its owner was invited.
  it('blocks Better Auth\'s own sign-up endpoint, with or without a query string', async () => {
    for (const path of ['/api/auth/sign-up/email', '/api/auth/sign-up/email?x=1', '/api/auth/sign-up/email/']) {
      await expect((middleware as Handler)(mkEvent(path))).rejects.toMatchObject({ statusCode: 404 })
    }
    expect(authHandlerMock).not.toHaveBeenCalled()
  })

  it('passes other auth routes through to Better Auth', async () => {
    await expect((middleware as Handler)(mkEvent('/api/auth/get-session', 'GET'))).resolves.toBe('handled-by-better-auth')
  })

  it('ignores non-auth paths', async () => {
    await expect((middleware as Handler)(mkEvent('/api/v1/content', 'GET'))).resolves.toBeUndefined()
    expect(authHandlerMock).not.toHaveBeenCalled()
  })
})
