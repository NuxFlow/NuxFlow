/**
 * Integration tests for GET /api/v1/audit-log.
 * Was previously a hardcoded, non-paginated 200-row cap with no way to reach
 * anything older — now paginated like admin/content/index.vue's own list.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: listHandler } = await import('../../server/api/v1/audit-log.get')

type Handler = (e: H3Event) => Promise<unknown>
type ListResult = { logs: { id: string; createdAt: string }[]; page: number; limit: number }

const SITE = 'site-audit-01'
let adminId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'audit.localhost' })
  adminId = await seedUser(db, { email: 'admin@audit.test' })
  await seedRole(db, adminId, SITE, 'admin')

  // Seed 5 entries with strictly increasing createdAt so ordering/paging is deterministic.
  for (let i = 0; i < 5; i++) {
    await db.insert(auditLogs).values({
      id: ulid(),
      siteId: SITE,
      userId: adminId,
      action: 'update',
      resource: 'content_item',
      resourceId: `item-${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    })
  }
})

afterAll(teardownTestDb)

function adminEvent(query?: Record<string, string>) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@audit.test' } },
    query,
  }) as unknown as H3Event
}

describe('GET /api/v1/audit-log', () => {
  it('returns entries newest-first', async () => {
    const result = await (listHandler as Handler)(adminEvent()) as ListResult
    const dates = result.logs.map(l => l.createdAt)
    expect(dates).toEqual([...dates].sort().reverse())
  })

  it('respects limit and page for pagination', async () => {
    const page1 = await (listHandler as Handler)(adminEvent({ limit: '2', page: '1' })) as ListResult
    const page2 = await (listHandler as Handler)(adminEvent({ limit: '2', page: '2' })) as ListResult
    expect(page1.logs).toHaveLength(2)
    expect(page2.logs).toHaveLength(2)
    expect(page1.logs.map(l => l.id)).not.toEqual(page2.logs.map(l => l.id))
  })

  it('requires admin role', async () => {
    const viewerId = await seedUser(getCurrentTestDb(), { email: 'viewer@audit.test' })
    await seedRole(getCurrentTestDb(), viewerId, SITE, 'viewer')
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: viewerId, name: 'Viewer', email: 'viewer@audit.test' } },
    }) as unknown as H3Event
    await expect((listHandler as Handler)(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
