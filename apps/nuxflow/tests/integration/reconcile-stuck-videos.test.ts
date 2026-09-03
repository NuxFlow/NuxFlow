import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { seedSite, seedVideoAsset } from '../helpers/seed'
import { videoAssets } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { reconcileStuckVideos } from '../../server/scheduled/reconcile-stuck-videos'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-reconcile-videos-01'

beforeAll(async () => {
  await initTestDb()
  await seedSite(getCurrentTestDb(), { id: SITE, domain: 'reconcile-videos.localhost' })
})

afterAll(teardownTestDb)

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19)
}

describe('reconcileStuckVideos', () => {
  it('marks processing rows older than the TTL as failed', async () => {
    const db = getCurrentTestDb()
    const staleId = await seedVideoAsset(db, SITE, {
      title: 'Stale Processing',
      status: 'processing',
      createdAt: hoursAgo(3),
    })

    const result = await reconcileStuckVideos()
    expect(result.reconciled).toBeGreaterThanOrEqual(1)

    const [row] = await db.select().from(videoAssets).where(eq(videoAssets.id, staleId))
    expect(row?.status).toBe('failed')
  })

  it('leaves recent processing rows untouched', async () => {
    const db = getCurrentTestDb()
    const freshId = await seedVideoAsset(db, SITE, {
      title: 'Fresh Processing',
      status: 'processing',
      createdAt: hoursAgo(0.1),
    })

    await reconcileStuckVideos()

    const [row] = await db.select().from(videoAssets).where(eq(videoAssets.id, freshId))
    expect(row?.status).toBe('processing')
  })

  it('leaves ready rows untouched regardless of age', async () => {
    const db = getCurrentTestDb()
    const readyId = await seedVideoAsset(db, SITE, {
      title: 'Old Ready Video',
      status: 'ready',
      createdAt: hoursAgo(10),
    })

    await reconcileStuckVideos()

    const [row] = await db.select().from(videoAssets).where(eq(videoAssets.id, readyId))
    expect(row?.status).toBe('ready')
  })

  it('returns reconciled: 0 when there is nothing stuck', async () => {
    const db = getCurrentTestDb()
    await db.delete(videoAssets)

    const result = await reconcileStuckVideos()
    expect(result.reconciled).toBe(0)
  })
})
