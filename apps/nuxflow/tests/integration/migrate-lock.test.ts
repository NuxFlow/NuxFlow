/**
 * Integration tests for the cross-isolate migration lock in server/middleware/00.migrate.ts.
 * Exercises the lock functions directly against a real SQLite DB — the module-level
 * _migrationsDone/_migrationPromise flags in the middleware only dedupe requests within
 * a single isolate, so they aren't what's being tested here; acquireMigrationLock /
 * releaseMigrationLock are the actual cross-isolate mutex.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { initTestDb, teardownTestDb, getCurrentTestDb, type TestDb } from '../helpers/db'
import { acquireMigrationLock, releaseMigrationLock } from '../../server/middleware/00.migrate'

beforeAll(initTestDb)
afterAll(teardownTestDb)

describe('acquireMigrationLock / releaseMigrationLock', () => {
  it('acquires the lock when nothing else holds it', async () => {
    const db = getCurrentTestDb()
    const acquired = await acquireMigrationLock(db)
    expect(acquired).toBe(true)
    await releaseMigrationLock(db)
  })

  it('only lets one of two concurrent callers acquire the lock', async () => {
    const db = getCurrentTestDb()
    const [first, second] = await Promise.all([acquireMigrationLock(db), acquireMigrationLock(db)])

    // Exactly one of the two concurrent attempts must win.
    expect([first, second].filter(Boolean)).toHaveLength(1)
    await releaseMigrationLock(db)
  })

  it('lets a new acquire succeed after the lock is released', async () => {
    const db = getCurrentTestDb()
    expect(await acquireMigrationLock(db)).toBe(true)
    await releaseMigrationLock(db)
    expect(await acquireMigrationLock(db)).toBe(true)
    await releaseMigrationLock(db)
  })

  it('reclaims a stale lock left behind by a crashed isolate', async () => {
    const db = getCurrentTestDb()

    // Simulate a crashed isolate: a lock row old enough to count as stale.
    await seedStaleLock(db)

    const acquired = await acquireMigrationLock(db)
    expect(acquired).toBe(true)
    await releaseMigrationLock(db)
  })

  it('does not reclaim a fresh lock held by another isolate', async () => {
    const db = getCurrentTestDb()
    expect(await acquireMigrationLock(db)).toBe(true)

    // A second isolate's attempt should fail fast (not wait out the full retry budget
    // successfully) since the lock is fresh, not stale.
    const acquired = await acquireMigrationLock(db)
    expect(acquired).toBe(false)

    await releaseMigrationLock(db)
  })
})

async function seedStaleLock(db: TestDb): Promise<void> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS _nuxflow_migration_lock (
      id INTEGER PRIMARY KEY,
      locked_at TEXT NOT NULL
    )
  `)
  await db.run(sql`DELETE FROM _nuxflow_migration_lock WHERE id = 1`)
  await db.run(sql`INSERT INTO _nuxflow_migration_lock (id, locked_at) VALUES (1, datetime('now', '-5 minutes'))`)
}
