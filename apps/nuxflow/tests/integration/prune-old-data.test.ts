/**
 * Integration test for server/scheduled/prune-old-data.ts's revision-pruning cap.
 *
 * Regression coverage for an unbounded N+1 query pattern: the old implementation ran
 * one D1 query per overflowing content item with no cap on how many items it processed
 * in a single scheduled run, and passed every resulting DELETE statement into a single
 * unbounded db.batch() call. This is the same class of failure documented at length in
 * d1-export.ts's module comment and CLAUDE.md's D1 section (D1's paid-plan cap is 1,000
 * queries per Worker invocation). The fix caps processing to MAX_OVERFLOW_ITEMS_PER_RUN
 * (100) items per run and chunks the DELETE batch — items left over are still
 * overflowing and get caught on the next scheduled run, since pruning is inherently
 * re-triggerable and doesn't need to be exhaustive in one pass.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { ulid } from 'ulid'
import { contentRevisions } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { seedSite, seedUser, seedContentType, seedContentItem } from '../helpers/seed'
import { pruneOldData } from '../../server/scheduled/prune-old-data'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-prune-01'
const TOTAL_OVERFLOWING_ITEMS = 105
const MAX_OVERFLOW_ITEMS_PER_RUN = 100 // mirrors the constant in prune-old-data.ts

const itemIds: string[] = []
let originalConfig: typeof globalThis.useRuntimeConfig

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'prune.localhost' })
  await seedUser(db, { email: 'admin@prune.test' })
  const typeId = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })

  // revisionRetentionCount is forced to 1 for this test so every item only needs 2
  // revisions to overflow, keeping the seed size manageable while still exceeding
  // MAX_OVERFLOW_ITEMS_PER_RUN (105 > 100).
  originalConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({
    auditLogRetentionDays: 90,
    revisionRetentionCount: 1,
    betterAuthSecret: 'test-secret-exactly-32-chars-ok!',
    cloudflareAccountId: '',
    cloudflareStreamToken: '',
    nuxtPublic: {},
    public: { i18n: { defaultLocale: 'en' } },
  }) as typeof globalThis.useRuntimeConfig

  for (let i = 0; i < TOTAL_OVERFLOWING_ITEMS; i++) {
    const itemId = await seedContentItem(db, SITE, typeId, {
      slug: `prune-post-${i}`,
      title: `Prune Post ${i}`,
    })
    itemIds.push(itemId)
  }

  // Two revisions per item (> retention count of 1, so every item overflows by exactly 1).
  const revisionRows = itemIds.flatMap((itemId, i) => [
    { id: ulid(), itemId, title: `Rev A ${i}`, createdAt: '2026-01-01 00:00:00' },
    { id: ulid(), itemId, title: `Rev B ${i}`, createdAt: '2026-01-02 00:00:00' },
  ])
  await db.insert(contentRevisions).values(revisionRows)
})

afterAll(async () => {
  globalThis.useRuntimeConfig = originalConfig
  await teardownTestDb()
})

describe('pruneOldData() revision cap', () => {
  it('processes at most MAX_OVERFLOW_ITEMS_PER_RUN overflowing items in a single run', async () => {
    const db = getCurrentTestDb()

    const result = await pruneOldData()

    // Exactly 100 items pruned (one revision each), not all 105.
    expect(result.prunedRevisions).toBe(MAX_OVERFLOW_ITEMS_PER_RUN)

    const remainingRevisions = await db.query.contentRevisions.findMany({})
    // 105 items * 2 revisions - 100 pruned = 110 remaining
    expect(remainingRevisions).toHaveLength(TOTAL_OVERFLOWING_ITEMS * 2 - MAX_OVERFLOW_ITEMS_PER_RUN)
  })

  it('catches the leftover overflowing items on the next run', async () => {
    const db = getCurrentTestDb()

    const result = await pruneOldData()

    // Only the remaining 5 items were still overflowing.
    expect(result.prunedRevisions).toBe(TOTAL_OVERFLOWING_ITEMS - MAX_OVERFLOW_ITEMS_PER_RUN)

    const remainingRevisions = await db.query.contentRevisions.findMany({})
    // Every item now has exactly 1 revision left (105 total).
    expect(remainingRevisions).toHaveLength(TOTAL_OVERFLOWING_ITEMS)
  })

  it('returns zero for every category once nothing is left to prune', async () => {
    const result = await pruneOldData()
    expect(result.prunedRevisions).toBe(0)
  })
})
