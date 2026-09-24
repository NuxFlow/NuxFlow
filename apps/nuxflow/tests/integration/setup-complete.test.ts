import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { accounts, sites, userSiteRoles, users } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite } from '../helpers/seed'
import handler from '../../server/api/v1/setup/complete.post'
import { nuxflowPasswordHasher } from '../../server/utils/pw'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(host: string, body: unknown) {
  return createMockEvent({
    body,
    path: '/api/v1/setup/complete',
    headers: { host },
  }) as unknown as H3Event
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    site: { name: 'Secondary Site', locale: 'en', timezone: 'UTC' },
    admin: { name: 'New Admin', email: 'newadmin@secondary.test', password: 'securePass9!' },
    template: 'blank',
    ...overrides,
  }
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  // Seed a dummy user so that userCount > 0 and we can test secondary site setup
  await db.insert(users).values({
    id: 'dummy-user',
    name: 'Dummy User',
    email: 'dummy@test.com',
  })
})
afterAll(teardownTestDb)

describe('POST /api/v1/setup/complete — pre-created secondary sites', () => {
  it('rejects completion when the site has no setup token issued', async () => {
    const db = getCurrentTestDb()
    await seedSite(db, { id: 'site-setup-no-token', domain: 'no-token.localhost', setupCompleted: false })

    await expect(
      (handler as HandlerFn)(mkEvent('no-token.localhost', payload())),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects completion with a missing or incorrect setup token', async () => {
    const db = getCurrentTestDb()
    const correctHash = await hashToken('the-real-token')
    await seedSite(db, { id: 'site-setup-wrong-token', domain: 'wrong-token.localhost', setupCompleted: false, setupTokenHash: correctHash })

    await expect(
      (handler as HandlerFn)(mkEvent('wrong-token.localhost', payload())),
    ).rejects.toMatchObject({ statusCode: 403 })

    await expect(
      (handler as HandlerFn)(mkEvent('wrong-token.localhost', payload({ setupToken: 'not-the-token' }))),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  // A secondary site is a tenant: its owner gets 'admin' on that site only. super_admin is
  // platform-wide (every site, whole-DB export), so completing a tenant's setup link must
  // never grant it.
  it('completes setup and grants admin (not super_admin) when the token matches, then burns it', async () => {
    const db = getCurrentTestDb()
    const rawToken = 'correct-horse-battery-staple'
    const hash = await hashToken(rawToken)
    const siteId = 'site-setup-good-token'
    await seedSite(db, { id: siteId, domain: 'good-token.localhost', setupCompleted: false, setupTokenHash: hash })

    const result = await (handler as HandlerFn)(
      mkEvent('good-token.localhost', payload({ setupToken: rawToken })),
    )
    expect(result).toMatchObject({ success: true, siteId })

    const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) })
    expect(site?.setupCompleted).toBe(true)
    expect(site?.setupTokenHash).toBeNull()

    const role = await db.query.userSiteRoles.findFirst({
      where: eq(userSiteRoles.siteId, siteId),
    })
    expect(role?.role).toBe('admin')

    // The token cannot be replayed — the site is already marked complete.
    await expect(
      (handler as HandlerFn)(mkEvent('good-token.localhost', payload({ setupToken: rawToken }))),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  // Accounts are global: naming an existing account's email must not be enough to be
  // handed this site's top role. The account's own password is required.
  it('requires the current password when the admin email belongs to an existing account', async () => {
    const db = getCurrentTestDb()
    await db.insert(users).values({ id: 'existing-owner', name: 'Owner', email: 'owner@existing.test' })
    await db.insert(accounts).values({
      id: 'existing-owner-cred',
      accountId: 'existing-owner',
      providerId: 'credential',
      issuer: 'local:credential',
      userId: 'existing-owner',
      password: await nuxflowPasswordHasher.hash('the-real-password'),
    })

    const rawToken = 'existing-account-token'
    const siteId = 'site-setup-existing-account'
    await seedSite(db, { id: siteId, domain: 'existing.localhost', setupCompleted: false, setupTokenHash: await hashToken(rawToken) })

    const admin = { name: '', email: 'owner@existing.test', password: 'wrong-password' }
    await expect(
      (handler as HandlerFn)(mkEvent('existing.localhost', payload({ setupToken: rawToken, admin }))),
    ).rejects.toMatchObject({ statusCode: 403 })

    // The rejected attempt must not have consumed the one-time token or touched the site.
    const untouched = await db.query.sites.findFirst({ where: eq(sites.id, siteId) })
    expect(untouched?.setupCompleted).toBe(false)
    expect(untouched?.setupTokenHash).not.toBeNull()

    const result = await (handler as HandlerFn)(mkEvent('existing.localhost', payload({
      setupToken: rawToken,
      admin: { ...admin, password: 'the-real-password' },
    })))
    expect(result).toMatchObject({ success: true, siteId })
    const role = await db.query.userSiteRoles.findFirst({
      where: and(eq(userSiteRoles.siteId, siteId), eq(userSiteRoles.userId, 'existing-owner')),
    })
    expect(role?.role).toBe('admin')
  })

  it('rejects an existing account with no password supplied', async () => {
    const db = getCurrentTestDb()
    const rawToken = 'no-password-token'
    await seedSite(db, { id: 'site-setup-no-pw', domain: 'no-pw.localhost', setupCompleted: false, setupTokenHash: await hashToken(rawToken) })
    await expect(
      (handler as HandlerFn)(mkEvent('no-pw.localhost', payload({
        setupToken: rawToken,
        admin: { name: '', email: 'owner@existing.test', password: '' },
      }))),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
