/**
 * Integration tests for demo-reset scheduled logic.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { seedSite } from '../helpers/seed'
import { demoFirstBoot, demoNightlyReset } from '../../server/scheduled/demo-reset'
import { sites, users, contentItems, taxonomies, userSiteRoles } from '@nuxflow/db/schema'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('better-auth/crypto', () => ({
  hashPassword: vi.fn().mockResolvedValue('$argon2id$test-hash'),
}))

const SITE = 'site-demo-01'

function withDemoRuntimeConfig<T>(fn: () => Promise<T>): Promise<T> {
  const originalConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({
    isDemo: true,
    betterAuthSecret: 'test-secret-exactly-32-chars-ok!',
    cloudflareAccountId: '',
    cloudflareStreamToken: '',
    nuxtPublic: {},
  })
  return fn().finally(() => {
    globalThis.useRuntimeConfig = originalConfig
  })
}

beforeAll(async () => {
  await initTestDb()
})

afterAll(teardownTestDb)

describe('demoFirstBoot()', () => {
  it('returns { skipped } when isDemo is falsy', async () => {
    const result = await demoFirstBoot()
    expect(result).toEqual({ skipped: true, reason: 'not a demo instance' })
  })

  it('returns { skipped, reason: "already seeded" } when DB already has sites', async () => {
    const db = getCurrentTestDb()
    await seedSite(db, { id: SITE, domain: 'demo.localhost' })
    try {
      const result = await withDemoRuntimeConfig(() => demoFirstBoot())
      expect(result).toEqual({ skipped: true, reason: 'already seeded' })
    } finally {
      await db.delete(sites).where(sql`id = ${SITE}`)
    }
  })
})

// Exercises the real destructive wipe-and-reseed path (35+ table deletes in
// wipeAllTables(), then a full seedDemo() insert) against an empty DB — the previous
// version of this file only ever tested the two early-return/skip branches above and
// never actually called seedDemo()/wipeAllTables(), leaving the one part of this
// feature that runs unattended in production (every night, on real demo data)
// completely unverified.
describe('demoNightlyReset()', () => {
  beforeEach(async () => {
    const db = getCurrentTestDb()
    // Start from a clean slate for each test — demoNightlyReset() itself wipes
    // everything, but a prior test's leftover rows would still corrupt the "isDemo
    // falsy" skip-check below (it only checks whether the DB is a demo instance, not
    // whether it's empty).
    await db.delete(sites)
  })

  it('returns { skipped } when isDemo is falsy', async () => {
    const result = await demoNightlyReset()
    expect(result).toEqual({ skipped: true, reason: 'not a demo instance' })
  })

  it('wipes existing data and reseeds a fresh demo site, user, and content', async () => {
    const db = getCurrentTestDb()
    await seedSite(db, { id: 'stale-site', domain: 'stale.localhost' })

    const result = await withDemoRuntimeConfig(() => demoNightlyReset())
    expect(result.reset).toBe(true)

    // The pre-existing site must be gone — this is the "wipe" half of the contract.
    const staleSite = await db.query.sites.findFirst({ where: (s, { eq }) => eq(s.id, 'stale-site') })
    expect(staleSite).toBeUndefined()

    // Exactly one fresh site/admin/content set must exist — the "reseed" half.
    const allSites = await db.select().from(sites)
    expect(allSites).toHaveLength(1)
    expect(allSites[0]?.domain).toBe('demo.nuxflow.dev')

    const admin = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, 'demo@nuxflow.dev') })
    expect(admin).toBeTruthy()

    const role = await db.query.userSiteRoles.findFirst({
      where: (r, { eq }) => eq(r.siteId, allSites[0]!.id),
    })
    expect(role?.role).toBe('super_admin')

    const items = await db.select().from(contentItems).where(sql`site_id = ${allSites[0]!.id}`)
    expect(items.length).toBeGreaterThanOrEqual(2) // home page + hello-world post

    const taxRows = await db.select().from(taxonomies).where(sql`site_id = ${allSites[0]!.id}`)
    expect(taxRows.length).toBeGreaterThanOrEqual(2) // category + post_tag
  })

  it('reseeding twice in a row does not leave duplicate or orphaned rows', async () => {
    const db = getCurrentTestDb()
    await withDemoRuntimeConfig(() => demoNightlyReset())
    await withDemoRuntimeConfig(() => demoNightlyReset())

    const allSites = await db.select().from(sites)
    expect(allSites).toHaveLength(1)

    const allUsers = await db.select().from(users)
    expect(allUsers).toHaveLength(1)

    const allRoles = await db.select().from(userSiteRoles)
    expect(allRoles).toHaveLength(1)
  })
})
