/**
 * Integration tests for server/middleware/03.api-key-auth.ts — validates Bearer API
 * keys (SHA-256 hash lookup), checks expiry, sets event.context.{apiKeyUserId, apiKeyRole}.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { bufferToHex } from '../../server/utils/buffer'
import { apiKeys } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import apiKeyMiddleware from '../../server/middleware/03.api-key-auth'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE_A = 'site-mw-a'
let apiKeyUserId: string

type MiddlewareFn = (e: H3Event) => Promise<unknown>

function mkApiKeyEvent(opts: { authorization?: string; siteId?: string } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE_A,
    headers: opts.authorization ? { authorization: opts.authorization } : {},
  }) as unknown as H3Event
}

async function sha256Hex(raw: string): Promise<string> {
  const encoder = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(raw))
  return bufferToHex(buf)
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE_A, domain: 'site-a.localhost', status: 'active', setupCompleted: true })
  apiKeyUserId = await seedUser(db, { email: 'apikey-user@middleware.test' })
  await seedRole(db, apiKeyUserId, SITE_A, 'editor')
})

afterAll(teardownTestDb)

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

  // Drizzle builders are lazy; the old `void db.update(...)` never executed, so
  // lastUsedAt stayed null forever. It now runs in the background via waitUntil.
  it('records lastUsedAt for a successfully authenticated key', async () => {
    const pending: Promise<unknown>[] = []
    const event = mkApiKeyEvent({ authorization: `Bearer ${RAW_KEY}` }) as unknown as { context: Record<string, unknown> }
    event.context.cloudflare = { ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p) } }

    await (apiKeyMiddleware as MiddlewareFn)(event as unknown as H3Event)
    expect(pending).toHaveLength(1)
    await Promise.all(pending)

    const row = await getCurrentTestDb().query.apiKeys.findFirst({ where: (k, { eq }) => eq(k.keyHash, keyHash) })
    expect(row!.lastUsedAt).toBeTruthy()
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

  it('treats a key as invalid when its owner has no (or no longer has a) site role row', async () => {
    // Simulates a user removed from the site (DELETE /api/v1/users/:id only deletes
    // their userSiteRoles row, not their API keys) — the key itself is still found
    // and unexpired, but must not fall back to a residual 'viewer' grant.
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
    expect(ctx.apiKeyUserId).toBeUndefined()
    expect(ctx.apiKeyRole).toBeUndefined()
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
