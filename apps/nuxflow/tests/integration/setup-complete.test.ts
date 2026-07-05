import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { sites, userSiteRoles } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite } from '../helpers/seed'
import handler from '../../server/api/v1/setup/complete.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
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

beforeAll(initTestDb)
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

  it('completes setup and grants super_admin when the token matches, then burns it', async () => {
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
    expect(role?.role).toBe('super_admin')

    // The token cannot be replayed — the site is already marked complete.
    await expect(
      (handler as HandlerFn)(mkEvent('good-token.localhost', payload({ setupToken: rawToken }))),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
