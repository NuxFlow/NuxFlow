/**
 * Integration test for POST /api/v1/push/subscribe
 * (server/api/v1/push/subscribe.post.ts)
 *
 * Regression coverage for a fix to the existing-subscription lookup: it used to match
 * on (userId, endpoint) only, omitting siteId. A user who belongs to more than one site
 * (a legitimate case in this multi-tenant CMS) and re-subscribes with the same
 * browser/endpoint on a second site would silently update the FIRST site's row instead
 * of creating a distinct per-site row — so broadcastPushToSite() for the second site
 * would never find that subscription. The lookup now also matches on siteId.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq, and } from 'drizzle-orm'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import subscribeHandler from '../../server/api/v1/push/subscribe.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

type HandlerFn = (e: H3Event) => Promise<unknown>

const SITE_A = 'site-push-a'
const SITE_B = 'site-push-b'
const ENDPOINT = 'https://push.example.com/endpoint/shared-browser'
let userId: string

function mkEvent(siteId: string, body: unknown) {
  return createMockEvent({
    siteId,
    session: { user: { id: userId, name: 'Push User', email: 'push-user@example.com' } },
    body,
  }) as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE_A, domain: 'push-a.localhost' })
  await seedSite(db, { id: SITE_B, domain: 'push-b.localhost' })
  userId = await seedUser(db, { email: 'push-user@example.com' })
  await seedRole(db, userId, SITE_A, 'member')
  await seedRole(db, userId, SITE_B, 'member')
})

afterAll(teardownTestDb)

describe('POST /api/v1/push/subscribe', () => {
  it('creates a distinct subscription row per site for the same user+endpoint', async () => {
    const db = getCurrentTestDb()

    await (subscribeHandler as HandlerFn)(mkEvent(SITE_A, {
      endpoint: ENDPOINT, p256dh: 'p256dh-a', auth: 'auth-a',
    }))
    await (subscribeHandler as HandlerFn)(mkEvent(SITE_B, {
      endpoint: ENDPOINT, p256dh: 'p256dh-b', auth: 'auth-b',
    }))

    const rows = await db.query.pushSubscriptions.findMany({
      where: and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, ENDPOINT)),
    })

    // Two distinct rows — one per site — not one row that got overwritten.
    expect(rows).toHaveLength(2)
    const bySite = new Map(rows.map(r => [r.siteId, r]))
    expect(bySite.get(SITE_A)?.p256dh).toBe('p256dh-a')
    expect(bySite.get(SITE_B)?.p256dh).toBe('p256dh-b')
  })

  it('still updates (not duplicates) the existing row when re-subscribing on the same site', async () => {
    const db = getCurrentTestDb()

    await (subscribeHandler as HandlerFn)(mkEvent(SITE_A, {
      endpoint: ENDPOINT, p256dh: 'p256dh-a-updated', auth: 'auth-a-updated',
    }))

    const rows = await db.query.pushSubscriptions.findMany({
      where: and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.siteId, SITE_A),
        eq(pushSubscriptions.endpoint, ENDPOINT),
      ),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.p256dh).toBe('p256dh-a-updated')
  })
})
