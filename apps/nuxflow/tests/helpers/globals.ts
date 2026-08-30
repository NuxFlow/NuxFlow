/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Nuxt/H3/Nitro auto-import mocks for Vitest.
 * Applied via setupFiles in vitest.integration.config.ts so every integration
 * test file gets these globals without explicit imports.
 */

import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// H3 auto-imports
// ---------------------------------------------------------------------------

globalThis.createError = ({ statusCode, message, data }: { statusCode?: number; message?: string; data?: unknown } = {}) => {
  const err = new Error(message ?? 'Error') as Error & { statusCode: number; data: unknown; fatal: boolean }
  err.statusCode = statusCode ?? 500
  err.data = data
  err.fatal = false
  return err
}

globalThis.defineEventHandler = (fn: unknown) => fn

globalThis.getQuery = (event: Record<string, unknown>) =>
  (event as { _query?: Record<string, string> })._query ?? {}

globalThis.getHeader = (event: Record<string, unknown>, name: string): string | null =>
  (event as { _headers?: Record<string, string> })._headers?.[name.toLowerCase()] ?? null

globalThis.getHeaders = (event: Record<string, unknown>): Record<string, string> =>
  (event as { _headers?: Record<string, string> })._headers ?? {}

globalThis.setHeader = (event: Record<string, unknown>, name: string, value: string): void => {
  const e = event as { _responseHeaders?: Record<string, string> }
  if (!e._responseHeaders) e._responseHeaders = {}
  e._responseHeaders[name] = value
}

globalThis.appendResponseHeader = (event: Record<string, unknown>, name: string, value: string): void => {
  const e = event as { _responseHeaders?: Record<string, string[]> }
  if (!e._responseHeaders) e._responseHeaders = {}
  const existing = e._responseHeaders[name]
  if (Array.isArray(existing)) {
    existing.push(value)
  } else {
    e._responseHeaders[name] = [value]
  }
}

globalThis.setResponseStatus = (event: Record<string, unknown>, status: number): void => {
  ;(event as { _status?: number })._status = status
}

globalThis.getRouterParam = (event: Record<string, unknown>, name: string): string | undefined =>
  (event as { _params?: Record<string, string> })._params?.[name]

globalThis.setCookie = (event: Record<string, unknown>, name: string, value: string): void => {
  const e = event as { _cookies?: Record<string, string> }
  if (!e._cookies) e._cookies = {}
  e._cookies[name] = value
}

globalThis.getCookie = (event: Record<string, unknown>, name: string): string | undefined =>
  (event as { _cookies?: Record<string, string> })._cookies?.[name]

globalThis.readBody = async (event: Record<string, unknown>): Promise<unknown> =>
  (event as { _body?: unknown })._body

globalThis.readValidatedBody = async (
  event: Record<string, unknown>,
  parser: (v: unknown) => unknown,
): Promise<unknown> => {
  const body = (event as { _body?: unknown })._body
  return parser(body)
}

globalThis.readRawBody = async (event: Record<string, unknown>): Promise<string | undefined> =>
  (event as { _rawBody?: string })._rawBody

globalThis.sendRedirect = vi.fn(async (event: Record<string, unknown>, url: string, code = 302) => {
  ;(event as { _redirect?: { url: string; code: number } })._redirect = { url, code }
  return null
})

globalThis.getRequestURL = (event: Record<string, unknown>): URL => {
  const path = (event as { _path?: string })._path ?? '/'
  const host = (event as { _headers?: Record<string, string> })._headers?.host ?? 'localhost'
  return new URL(`http://${host}${path}`)
}

// ---------------------------------------------------------------------------
// server/utils/response.ts and server/utils/validate.ts auto-imports
//
// These are app-level (not h3/Nitro-provided) `server/utils/*` helpers, but
// they're consumed unimported by route handlers the same way h3's own
// auto-imports are (Nitro's build-time auto-import transform covers both).
// Vitest doesn't run that transform, so — like every other auto-import above —
// they need an explicit globalThis stub mirroring the real implementation.
// ---------------------------------------------------------------------------

globalThis.ok = (data: unknown) => data

globalThis.created = (event: Record<string, unknown>, data: unknown) => {
  globalThis.setResponseStatus(event, 201)
  return data
}

globalThis.noContent = (event: Record<string, unknown>) => {
  globalThis.setResponseStatus(event, 204)
  return null
}

globalThis.notFound = (message = 'Not found') => {
  throw globalThis.createError({ statusCode: 404, message })
}

globalThis.unauthorized = (message = 'Unauthorized') => {
  throw globalThis.createError({ statusCode: 401, message })
}

globalThis.forbidden = (message = 'Forbidden') => {
  throw globalThis.createError({ statusCode: 403, message })
}

globalThis.conflict = (message = 'Conflict') => {
  throw globalThis.createError({ statusCode: 409, message })
}

globalThis.validationError = (message = 'Validation error', data?: unknown) => {
  throw globalThis.createError({ statusCode: 422, message, data })
}

globalThis.parseBody = async (event: Record<string, unknown>, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { flatten: () => unknown } } }) => {
  const body = await globalThis.readBody(event)
  const result = schema.safeParse(body)
  if (!result.success) {
    throw globalThis.createError({ statusCode: 422, message: 'Validation error', data: result.error?.flatten() })
  }
  return result.data
}

globalThis.parseQuery = (event: Record<string, unknown>, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { flatten: () => unknown } } }) => {
  const query = globalThis.getQuery(event)
  const result = schema.safeParse(query)
  if (!result.success) {
    throw globalThis.createError({ statusCode: 422, message: 'Validation error', data: result.error?.flatten() })
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Nuxt/Nitro auto-imports
// ---------------------------------------------------------------------------

globalThis.useRuntimeConfig = () => ({
  betterAuthSecret: 'test-secret-exactly-32-chars-ok!',
  cloudflareAccountId: '',
  cloudflareStreamToken: '',
  nuxtPublic: {},
})

// ---------------------------------------------------------------------------
// Session test doubles
// ---------------------------------------------------------------------------

globalThis.getUserSession = async (event: Record<string, unknown>) =>
  (event as { context?: { _session?: unknown } }).context?._session ?? null

globalThis.requireUserSession = async (event: Record<string, unknown>) => {
  const session = (event as { context?: { _session?: unknown } }).context?._session
  if (!session) {
    const err = globalThis.createError({ statusCode: 401, message: 'Unauthorized' })
    throw err
  }
  return session
}

// server/utils/auth.ts's requireSession/getAuthSession — the app's own session
// helpers (backed by getOrCreateBetterAuth, see server/utils/better-auth.ts) —
// reuse the same test-double shape/behaviour as the fixtures above so existing
// test fixtures (event.context._session) keep working unchanged.
globalThis.requireSession = globalThis.requireUserSession
globalThis.getAuthSession = globalThis.getUserSession

// useDb is NOT mocked globally — each integration test file provides its own
// vi.mock for '../../server/utils/db' to inject the real in-memory test DB.
