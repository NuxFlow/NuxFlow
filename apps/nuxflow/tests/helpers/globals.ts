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
// Nuxt/Nitro auto-imports
// ---------------------------------------------------------------------------

globalThis.useRuntimeConfig = () => ({
  betterAuthSecret: 'test-secret-exactly-32-chars-ok!',
  cloudflareAccountId: '',
  cloudflareStreamToken: '',
  nuxtPublic: {},
})

// ---------------------------------------------------------------------------
// nuxt-better-auth auto-imports
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

// server/utils/auth.ts's requireSession — the app's own session helper (backed by
// getOrCreateBetterAuth, see server/utils/better-auth.ts) that superseded the
// nuxt-better-auth-provided requireUserSession above for all server-side checks.
// Same test-double shape/behaviour so existing test fixtures (event.context._session)
// keep working unchanged.
globalThis.requireSession = globalThis.requireUserSession

// useDb is NOT mocked globally — each integration test file provides its own
// vi.mock for '../../server/utils/db' to inject the real in-memory test DB.
