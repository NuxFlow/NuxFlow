/**
 * Integration tests for Nitro middleware.
 *
 * 02.multi-site.ts  — resolves the current site from the Host header, sets
 *   event.context.{siteId, siteStatus, setupCompleted}, handles maintenance mode
 *   and the single-site fallback.
 *
 * 03.api-key-auth.ts — validates Bearer API keys (SHA-256 hash lookup), checks
 *   expiry, sets event.context.{apiKeyUserId, apiKeyRole}.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { apiKeys } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import multiSiteMiddleware from '../../server/middleware/02.multi-site'
import apiKeyMiddleware from '../../server/middleware/03.api-key-auth'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE_A = 'site-mw-a'
const SITE_B = 'site-mw-maint'
let apiKeyUserId: string

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MiddlewareFn = (e: H3Event) => Promise<unknown>

/**
 * Creates a mock event with `path` exposed as a direct property so the
 * multi-site middleware can read `event.path` without going through a helper.
 */
function mkSiteEvent(opts: { host?: string; path?: string } = {}) {
  const base = createMockEvent({
    headers: opts.host ? { host: opts.host } : {},
  }) as unknown as Record<string, unknown>

  // The middleware reads event.path directly — it's not exposed by createMockEvent
  base.path = opts.path ?? '/'

  return base as unknown as H3Event
}

function mkApiKeyEvent(opts: { authorization?: string; siteId?: string } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE_A,
    headers: opts.authorization ? { authorization: opts.authorization } : {},
  }) as unknown as H3Event
}

async function sha256Hex(raw: string): Promise<string> {
  const encoder = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(raw))
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE_A, domain: 'site-a.localhost', status: 'active', setupCompleted: true })
  await seedSite(db, { id: SITE_B, domain: 'site-b.localhost', status: 'maintenance', setupCompleted: true })

  apiKeyUserId = await seedUser(db, { email: 'apikey-user@middleware.test' })
  await seedRole(db, apiKeyUserId, SITE_A, 'editor')
})

afterAll(teardownTestDb)

// ---------------------------------------------------------------------------
// 02.multi-site.ts
// ---------------------------------------------------------------------------

describe('02.multi-site middleware', () => {
  it('resolves siteId from the Host header (exact domain match)', async () => {
    const event = mkSiteEvent({ host: 'site-a.localhost', path: '/some-page' })
    await (multiSiteMiddleware as MiddlewareFn)(event)
    expect((event as unknown as { context: { siteId: string } }).context.siteId).toBe(SITE_A)
  })

  it('sets siteStatus and setupCompleted alongside siteId', async () => {
    const event = mkSiteEvent({ host: 'site-a.localhost', path: '/' })
    await (multiSiteMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.siteStatus).toBe('active')
    expect(ctx.setupCompleted).toBe(true)
  })

  it('sets siteId to null when the host does not match and multiple sites exist', async () => {
    const event = mkSiteEvent({ host: 'completely-unknown.host', path: '/' })
    await (multiSiteMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context

    // Two sites exist → no fallback → null
    expect(ctx.siteId).toBeNull()
  })

  it('bypasses DB lookup for /api/v1/setup paths', async () => {
    const event = mkSiteEvent({ host: 'unknown-host.localhost', path: '/api/v1/setup/complete' })
    // Should return early without throwing, leaving siteId as whatever was in context
    const result = await (multiSiteMiddleware as MiddlewareFn)(event)
    expect(result).toBeUndefined()
  })

  it('bypasses DB lookup for /api/auth paths', async () => {
    const event = mkSiteEvent({ host: 'unknown-host.localhost', path: '/api/auth/session' })
    const result = await (multiSiteMiddleware as MiddlewareFn)(event)
    expect(result).toBeUndefined()
  })

  it('returns maintenance HTML for public paths when site is in maintenance mode', async () => {
    const event = mkSiteEvent({ host: 'site-b.localhost', path: '/my-page' })
    const result = await (multiSiteMiddleware as MiddlewareFn)(event) as string

    expect(typeof result).toBe('string')
    expect(result).toContain('Down for maintenance')
    expect((event as unknown as { _status: number })._status).toBe(503)
  })

  it('does not intercept /admin paths during maintenance mode', async () => {
    const event = mkSiteEvent({ host: 'site-b.localhost', path: '/admin/dashboard' })
    const result = await (multiSiteMiddleware as MiddlewareFn)(event)

    // Admin path should not return the maintenance page (returns undefined to pass through)
    expect(result).toBeUndefined()
    expect((event as unknown as { _status?: number })._status).not.toBe(503)
  })

  it('does not intercept /api paths during maintenance mode', async () => {
    const event = mkSiteEvent({ host: 'site-b.localhost', path: '/api/v1/content' })
    const result = await (multiSiteMiddleware as MiddlewareFn)(event)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 03.api-key-auth.ts
// ---------------------------------------------------------------------------

describe('03.api-key-auth middleware', () => {
  const RAW_KEY = 'nf_test_key_abc123def456'
  let keyHash: string

  beforeAll(async () => {
    keyHash = await sha256Hex(RAW_KEY)

    await getCurrentTestDb().insert(apiKeys).values({
      id: ulid(),
      siteId: SITE_A,
      userId: apiKeyUserId,
      name: 'Test API Key',
      keyHash,
      scopes: [],
      expiresAt: null,
    })
  })

  it('skips when there is no Authorization header', async () => {
    const event = mkApiKeyEvent()
    await (apiKeyMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.apiKeyUserId).toBeUndefined()
    expect(ctx.apiKeyRole).toBeUndefined()
  })

  it('skips when the Authorization header is not a Bearer token', async () => {
    const event = mkApiKeyEvent({ authorization: 'Basic dXNlcjpwYXNz' })
    await (apiKeyMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.apiKeyUserId).toBeUndefined()
  })

  it('skips when the key hash does not exist in the database', async () => {
    const event = mkApiKeyEvent({ authorization: 'Bearer nonexistent_key_xyz' })
    await (apiKeyMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.apiKeyUserId).toBeUndefined()
  })

  it('sets apiKeyUserId and apiKeyRole on a valid key', async () => {
    const event = mkApiKeyEvent({ authorization: `Bearer ${RAW_KEY}` })
    await (apiKeyMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.apiKeyUserId).toBe(apiKeyUserId)
    expect(ctx.apiKeyRole).toBe('editor')
  })

  it('defaults apiKeyRole to viewer when the user has no site role row', async () => {
    const noRoleUser = await seedUser(getCurrentTestDb(), { email: 'norole@middleware.test' })
    const noRoleKey = 'nf_norole_key_xyz789'
    const noRoleHash = await sha256Hex(noRoleKey)

    await getCurrentTestDb().insert(apiKeys).values({
      id: ulid(),
      siteId: SITE_A,
      userId: noRoleUser,
      name: 'No-role API Key',
      keyHash: noRoleHash,
      scopes: [],
      expiresAt: null,
    })

    const event = mkApiKeyEvent({ authorization: `Bearer ${noRoleKey}` })
    await (apiKeyMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.apiKeyUserId).toBe(noRoleUser)
    expect(ctx.apiKeyRole).toBe('viewer')
  })

  it('skips when the key is expired', async () => {
    const expiredKey = 'nf_expired_key_abc000'
    const expiredHash = await sha256Hex(expiredKey)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString()

    await getCurrentTestDb().insert(apiKeys).values({
      id: ulid(),
      siteId: SITE_A,
      userId: apiKeyUserId,
      name: 'Expired Key',
      keyHash: expiredHash,
      scopes: [],
      expiresAt: yesterday,
    })

    const event = mkApiKeyEvent({ authorization: `Bearer ${expiredKey}` })
    await (apiKeyMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.apiKeyUserId).toBeUndefined()
  })

  it('skips when no siteId is set on the event context (middleware chain ordering)', async () => {
    const event = mkApiKeyEvent({ authorization: `Bearer ${RAW_KEY}`, siteId: '' })
    // Manually clear siteId to simulate middleware running before multi-site
    ;(event as unknown as { context: Record<string, unknown> }).context.siteId = null
    await (apiKeyMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.apiKeyUserId).toBeUndefined()
  })
})
