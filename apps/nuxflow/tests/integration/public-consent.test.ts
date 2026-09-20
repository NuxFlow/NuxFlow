import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite } from '../helpers/seed'
import { consentLogs } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import handler from '../../server/api/public/consent.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// rate-limit.ts calls useDb() as a bare Nitro auto-import with no explicit import
// statement of its own (works in the real built Worker, where Nitro injects it) — every
// other integration test that touches a rate-limited route mocks this module wholesale
// rather than exercising the real implementation, and this file follows the same
// convention rather than being the first to hit that pre-existing gap.
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: async () => {},
}))

const SITE = 'site-public-consent-01'

type HandlerFn = (e: H3Event) => Promise<unknown>

beforeAll(async () => {
  await initTestDb()
  await seedSite(getCurrentTestDb(), { id: SITE, domain: 'public-consent.localhost' })
})

afterAll(teardownTestDb)

function mkEvent(body: unknown, siteId: string | null = SITE) {
  const event = createMockEvent({ siteId: siteId ?? SITE, body, headers: { 'user-agent': 'vitest-agent' } })
  if (siteId === null) event.context.siteId = null as unknown as string
  return event as unknown as H3Event
}

describe('POST /api/public/consent', () => {
  it('records an anonymous, site-scoped consent log entry', async () => {
    const db = getCurrentTestDb()
    await (handler as HandlerFn)(mkEvent({ analytics: true, marketing: false }))

    const rows = await db.query.consentLogs.findMany({ where: eq(consentLogs.siteId, SITE) })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ analytics: true, marketing: false, siteId: SITE })
    expect(rows[0]!.userAgent).toBe('vitest-agent')
    // No visitor-identifying fields exist on the row at all — enforced by the schema
    // itself (no userId/ip columns), not just by this route choosing not to set them.
    expect(Object.keys(rows[0]!)).not.toContain('userId')
    expect(Object.keys(rows[0]!)).not.toContain('ipAddress')
  })

  it('rejects a non-boolean payload', async () => {
    await expect((handler as HandlerFn)(mkEvent({ analytics: 'yes', marketing: false })))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('is a no-op when no site could be resolved, rather than throwing', async () => {
    await expect((handler as HandlerFn)(mkEvent({ analytics: true, marketing: true }, null))).resolves.toBeNull()
  })
})
