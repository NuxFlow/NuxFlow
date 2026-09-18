/**
 * Integration tests for the API key CRUD routes. middleware.test.ts already exercises the
 * authentication middleware (03.api-key-auth.ts) by inserting apiKeys rows directly into
 * the test DB, but never through the real POST/DELETE routes — so the hashing-on-creation
 * logic (is the raw key actually hashed before storage, is it ever leaked back out anywhere
 * other than the one-time creation response) and the revocation logic itself were untested.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { apiKeys, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import createHandler from '../../server/api/v1/api-keys/index.post'
import listHandler from '../../server/api/v1/api-keys/index.get'
import deleteHandler from '../../server/api/v1/api-keys/[id].delete'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const SITE = 'site-apikeys-01'
let adminId: string
let authorId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'apikeys.localhost' })
  adminId = await seedUser(db, { email: 'admin@apikeys.test' })
  await seedRole(db, adminId, SITE, 'admin')
  authorId = await seedUser(db, { email: 'author@apikeys.test' })
  await seedRole(db, authorId, SITE, 'author')
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(uid: string | null, body?: unknown, params?: Record<string, string>) {
  return createMockEvent({
    siteId: SITE,
    session: uid ? { user: { id: uid, name: 'User', email: `${uid}@apikeys.test` } } : null,
    body,
    params,
  }) as unknown as H3Event
}

describe('POST /api/v1/api-keys', () => {
  it('throws 403 for a non-admin (author) caller', async () => {
    await expect((createHandler as HandlerFn)(mkEvent(authorId, { name: 'My Key' }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates a key, returning the raw key only once, with a real SHA-256 hash stored — never the raw key itself', async () => {
    const db = getCurrentTestDb()
    const result = await (createHandler as HandlerFn)(mkEvent(adminId, { name: 'CI key' })) as { id: string; key: string }

    expect(result.key).toMatch(/^nf_/)

    const row = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.id, result.id), eq(apiKeys.siteId, SITE)) })
    expect(row).toBeDefined()
    expect(row!.keyHash).not.toBe(result.key)
    expect(row!.keyHash).toBe(await sha256Hex(result.key))
    // Defaults from the schema when scopes isn't passed.
    expect(row!.scopes).toEqual(['read:content'])

    // The raw key must never end up in the audit trail either — only name/scopes.
    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.resource, 'api_key'), eq(auditLogs.resourceId, result.id)))
    expect(log).toBeDefined()
    expect(log.action).toBe('create')
    expect(JSON.stringify(log.after)).not.toContain(result.key)
    expect(JSON.stringify(log.after)).not.toContain(row!.keyHash)
  })

  it('produces a different raw key and hash on every call (no key reuse)', async () => {
    const a = await (createHandler as HandlerFn)(mkEvent(adminId, { name: 'Key A' })) as { id: string; key: string }
    const b = await (createHandler as HandlerFn)(mkEvent(adminId, { name: 'Key B' })) as { id: string; key: string }
    expect(a.key).not.toBe(b.key)
    expect(a.id).not.toBe(b.id)
  })

  it('respects custom scopes and expiresAt', async () => {
    const db = getCurrentTestDb()
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
    const result = await (createHandler as HandlerFn)(mkEvent(adminId, { name: 'Scoped key', scopes: ['read:content', 'write:content'], expiresAt })) as { id: string }

    const row = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.id, result.id), eq(apiKeys.siteId, SITE)) })
    expect(row!.scopes).toEqual(['read:content', 'write:content'])
    expect(row!.expiresAt).toBe(expiresAt)
  })

  it('rejects an empty name', async () => {
    await expect((createHandler as HandlerFn)(mkEvent(adminId, { name: '' }))).rejects.toBeTruthy()
  })
})

describe('GET /api/v1/api-keys', () => {
  it('only lists keys belonging to the caller\'s own site, and never exposes keyHash', async () => {
    const db = getCurrentTestDb()
    const otherSite = await seedSite(db, { domain: 'other-apikeys.localhost' })
    const otherAdmin = await seedUser(db, { email: 'admin@other-apikeys.test' })
    await seedRole(db, otherAdmin, otherSite, 'admin')
    await (createHandler as HandlerFn)(createMockEvent({
      siteId: otherSite,
      session: { user: { id: otherAdmin, name: 'Other Admin', email: 'admin@other-apikeys.test' } },
      body: { name: 'Other site key' },
    }) as unknown as H3Event)

    const result = await (listHandler as HandlerFn)(mkEvent(adminId)) as { apiKeys: Array<Record<string, unknown>> }
    expect(result.apiKeys.some(k => k.name === 'Other site key')).toBe(false)
    expect(result.apiKeys.length).toBeGreaterThan(0)
    for (const key of result.apiKeys) {
      expect(key).not.toHaveProperty('keyHash')
    }
  })
})

describe('DELETE /api/v1/api-keys/:id', () => {
  it('throws 403 for a non-admin caller', async () => {
    const db = getCurrentTestDb()
    const created = await (createHandler as HandlerFn)(mkEvent(adminId, { name: 'To revoke (forbidden test)' })) as { id: string }
    await expect((deleteHandler as HandlerFn)(mkEvent(authorId, undefined, { id: created.id }))).rejects.toMatchObject({ statusCode: 403 })
    // Sanity: it wasn't actually deleted by the rejected attempt.
    const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, created.id) })
    expect(row).toBeDefined()
  })

  it('throws 404 for a key that does not exist (or belongs to another site)', async () => {
    await expect((deleteHandler as HandlerFn)(mkEvent(adminId, undefined, { id: 'nonexistent-key-id' }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('revokes an existing key, removing it from the DB and writing an audit log', async () => {
    const db = getCurrentTestDb()
    const created = await (createHandler as HandlerFn)(mkEvent(adminId, { name: 'To revoke' })) as { id: string }

    const result = await (deleteHandler as HandlerFn)(mkEvent(adminId, undefined, { id: created.id }))
    expect(result).toBeNull()

    const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, created.id) })
    expect(row).toBeUndefined()

    const [deleteLog] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.resource, 'api_key'), eq(auditLogs.resourceId, created.id), eq(auditLogs.action, 'delete')))
    expect(deleteLog).toBeDefined()
  })

  it('cannot revoke a key belonging to a different site', async () => {
    const db = getCurrentTestDb()
    const otherSite = await seedSite(db, { domain: 'cross-tenant-apikeys.localhost' })
    const otherAdmin = await seedUser(db, { email: 'admin@cross-tenant-apikeys.test' })
    await seedRole(db, otherAdmin, otherSite, 'admin')
    const created = await (createHandler as HandlerFn)(createMockEvent({
      siteId: otherSite,
      session: { user: { id: otherAdmin, name: 'Cross Admin', email: 'admin@cross-tenant-apikeys.test' } },
      body: { name: 'Cross-tenant key' },
    }) as unknown as H3Event) as { id: string }

    // Same key id, but this admin's session is scoped to SITE, not otherSite.
    await expect((deleteHandler as HandlerFn)(mkEvent(adminId, undefined, { id: created.id }))).rejects.toMatchObject({ statusCode: 404 })

    const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, created.id) })
    expect(row).toBeDefined()
  })
})
