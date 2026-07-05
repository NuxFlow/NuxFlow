/**
 * Integration tests for scheduled task logic.
 *
 * publishScheduled() — queries contentItems for due scheduled items and marks them published.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { seedSite, seedUser, seedContentType, seedContentItem } from '../helpers/seed'
import { contentItems } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { publishScheduled } from '../../server/scheduled/publish-scheduled'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// hashPassword (argon2) is slow and environment-dependent; stub it
vi.mock('better-auth/crypto', () => ({
  hashPassword: vi.fn().mockResolvedValue('$argon2id$test-hash'),
}))

const SITE = 'site-scheduled-01'
let typeId: string
let dueItemId: string
let futureItemId: string
let notScheduledItemId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'scheduled.localhost' })
  await seedUser(db, { email: 'admin@scheduled.test' })
  typeId = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })

  // SQLite's datetime('now') returns 'YYYY-MM-DD HH:MM:SS' (space, no Z, no ms).
  // scheduledAt must use the same format so lte(..., datetime('now')) evaluates correctly.
  const toSqlite = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
  const past = toSqlite(Date.now() - 60_000)
  const future = toSqlite(Date.now() + 3_600_000)

  dueItemId = await seedContentItem(db, SITE, typeId, {
    slug: 'due-post',
    title: 'Due Post',
    status: 'scheduled',
    scheduledAt: past,
    publishedAt: null,
  })

  futureItemId = await seedContentItem(db, SITE, typeId, {
    slug: 'future-post',
    title: 'Future Post',
    status: 'scheduled',
    scheduledAt: future,
    publishedAt: null,
  })

  notScheduledItemId = await seedContentItem(db, SITE, typeId, {
    slug: 'draft-untouched',
    title: 'Draft Post',
    status: 'draft',
    publishedAt: null,
  })
})

afterAll(teardownTestDb)

// ---------------------------------------------------------------------------
// publishScheduled
// ---------------------------------------------------------------------------

describe('publishScheduled()', () => {
  it('publishes exactly the items whose scheduledAt is in the past', async () => {
    const result = await publishScheduled()
    expect(result.published).toBe(1)
  })

  it('sets status to published on the due item', async () => {
    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: eq(contentItems.id, dueItemId),
    })
    expect(item!.status).toBe('published')
  })

  it('sets publishedAt on the newly published item', async () => {
    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: eq(contentItems.id, dueItemId),
    })
    expect(item!.publishedAt).toBeTruthy()
  })

  it('does not touch items whose scheduledAt is in the future', async () => {
    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: eq(contentItems.id, futureItemId),
    })
    expect(item!.status).toBe('scheduled')
    expect(item!.publishedAt).toBeNull()
  })

  it('does not touch draft items (only acts on scheduled status)', async () => {
    const item = await getCurrentTestDb().query.contentItems.findFirst({
      where: eq(contentItems.id, notScheduledItemId),
    })
    expect(item!.status).toBe('draft')
  })

  it('returns { published: 0 } when called again with nothing due', async () => {
    // The due item is already published; nothing else is past-due
    const result = await publishScheduled()
    expect(result.published).toBe(0)
  })
})

