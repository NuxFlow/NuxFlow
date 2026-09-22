import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb, getD1 } from '../utils/db'
import { errorMessage } from '../utils/errors'

// Module-level flags per Worker isolate.
// _migrationsDone lets the common path (already migrated) skip all async overhead.
// _migrationPromise serialises concurrent cold-start requests so only one runs D1 ops.
// Reset both on failure so the next request retries.
let _migrationsDone = false
let _migrationPromise: Promise<void> | null = null

export default defineEventHandler(async (event) => {
  if (_migrationsDone) return
  if (!_migrationPromise) {
    _migrationPromise = applyMigrations(event).then(() => {
      _migrationsDone = true
    }).catch((err) => {
      console.error('[nuxflow:migrate]', errorMessage(err, String(err)))
      _migrationPromise = null
    })
  }
  await _migrationPromise
})

// Cloudflare can spin up multiple Worker isolates concurrently on a cold deploy, each
// running this same middleware with its own independent _migrationsDone/_migrationPromise
// state — those flags only serialise requests *within* one isolate. Without a real lock,
// two isolates could race to run the same ALTER/CREATE against the same D1 database at
// once. D1 serialises writes to a single database, so an INSERT against a PK-constrained
// lock row is a reliable cross-isolate mutex: only one isolate's INSERT can succeed.
const MIGRATION_LOCK_STALE_SECONDS = 30
const MIGRATION_LOCK_ACQUIRE_ATTEMPTS = 5
const MIGRATION_LOCK_RETRY_DELAY_MS = 200

export async function acquireMigrationLock(db: ReturnType<typeof useDb>): Promise<boolean> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS _nuxflow_migration_lock (
      id INTEGER PRIMARY KEY,
      locked_at TEXT NOT NULL
    )
  `)

  // Reclaim a stale lock — an isolate that crashed mid-migration would otherwise block
  // every future deploy's migrations forever.
  await db.run(sql`
    DELETE FROM _nuxflow_migration_lock
    WHERE id = 1 AND locked_at < datetime('now', ${`-${MIGRATION_LOCK_STALE_SECONDS} seconds`})
  `)

  for (let attempt = 0; attempt < MIGRATION_LOCK_ACQUIRE_ATTEMPTS; attempt++) {
    try {
      await db.run(sql`INSERT INTO _nuxflow_migration_lock (id, locked_at) VALUES (1, datetime('now'))`)
      return true
    } catch {
      // Another isolate holds the lock — short backoff before the next attempt.
      if (attempt < MIGRATION_LOCK_ACQUIRE_ATTEMPTS - 1) {
        await new Promise(resolve => setTimeout(resolve, MIGRATION_LOCK_RETRY_DELAY_MS))
      }
    }
  }
  return false
}

export async function releaseMigrationLock(db: ReturnType<typeof useDb>): Promise<void> {
  await db.run(sql`DELETE FROM _nuxflow_migration_lock WHERE id = 1`).catch(() => {})
}

const MIGRATION_WAIT_POLL_ATTEMPTS = 15
const MIGRATION_WAIT_POLL_DELAY_MS = 400

// Polls until every file in `expectedKeys` shows up in `_nuxflow_migrations`, i.e. the
// isolate that holds the lock has actually finished. Returns false (not an error) on
// timeout so the caller can fail open rather than hang the request indefinitely.
//
// Uses the raw D1 binding (getD1) with `.prepare().all()` rather than Drizzle's
// `db.values()` — this project's integration-test harness was separately found to
// return a different row shape from Drizzle's `.values()`/`.raw()` than the real D1
// adapter does (see d1-stats.ts's module doc), and that mismatch was never verified
// against a real deploy for this specific call, on the single most critical path in the
// app (every cold start gates on this). `D1Database.prepare().all()`'s `{ results: T[] }`
// contract is Cloudflare's own stable, documented shape instead.
async function waitForMigrationsToComplete(event: H3Event, expectedKeys: string[]): Promise<boolean> {
  for (let attempt = 0; attempt < MIGRATION_WAIT_POLL_ATTEMPTS; attempt++) {
    try {
      const d1 = getD1(event)
      const { results } = await d1.prepare('SELECT filename FROM _nuxflow_migrations').all<{ filename: string }>()
      const applied = new Set(results.map(r => r.filename))
      if (expectedKeys.every(k => applied.has(k))) return true
    } catch {
      // _nuxflow_migrations doesn't exist yet — the winner hasn't created it. Keep polling.
    }
    await new Promise(resolve => setTimeout(resolve, MIGRATION_WAIT_POLL_DELAY_MS))
  }
  return false
}

async function applyMigrations(event: H3Event) {
  const storage = useStorage('assets/migrations')
  const keys = (await storage.getKeys()).filter(k => !k.startsWith('meta:')).sort()
  if (!keys.length) return

  // Fast path: a single read-only SELECT, no lock table touched at all. Every cold
  // Worker isolate runs this function once (module-level _migrationsDone resets per
  // isolate — see the top of this file), and in steady state (no new migration files
  // since the last deploy that already ran) there is nothing to do. Without this check,
  // every single cold isolate paid the full acquireMigrationLock() dance (CREATE TABLE +
  // DELETE stale + INSERT lock = 3 round trips) plus another CREATE TABLE + SELECT +
  // release DELETE below — 5-6 sequential D1 round trips just to conclude "nothing to
  // do", on the single most latency-sensitive path in the app (it runs before every
  // other middleware, including the page-cache short-circuit). Confirmed against the
  // live deployment: cold-isolate requests ran 2-7s versus 76-220ms on a warm isolate.
  // Only when a migration is genuinely missing (the rare case: a fresh deploy just added
  // migration files) does this fall through to the real lock-acquire-and-run flow below,
  // which still fully serializes concurrently cold-starting isolates as before.
  try {
    const d1 = getD1(event)
    const { results } = await d1.prepare('SELECT filename FROM _nuxflow_migrations').all<{ filename: string }>()
    const applied = new Set(results.map(r => r.filename))
    if (keys.every(k => applied.has(k))) return
  } catch {
    // _nuxflow_migrations doesn't exist yet (fresh install) — fall through to the real
    // migration flow, which creates it.
  }

  const db = useDb(event)

  const acquired = await acquireMigrationLock(db)
  if (!acquired) {
    // Another isolate is already migrating. acquireMigrationLock already spent
    // MIGRATION_LOCK_ACQUIRE_ATTEMPTS * MIGRATION_LOCK_RETRY_DELAY_MS (~1s) trying to
    // get the lock itself — that budget is fine for *acquiring* a free lock, but a real
    // migration run (multiple ALTER/CREATE statements) can easily take longer than 1s
    // total, especially on a large existing database. Rather than assume the winner is
    // done and let this request straight through to route handlers that may query a
    // schema that isn't there yet, poll until every known migration file is recorded as
    // applied (bounded, so a genuinely crashed winner — lock will go stale after
    // MIGRATION_LOCK_STALE_SECONDS and the next request will re-acquire and retry —
    // doesn't hang this request forever).
    const winnerDone = await waitForMigrationsToComplete(event, keys)
    if (!winnerDone) {
      console.warn('[nuxflow:migrate] Timed out waiting for another isolate to finish migrating — proceeding anyway')
    }
    return
  }

  try {
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS _nuxflow_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)

    // See waitForMigrationsToComplete's doc above for why this uses the raw D1 binding
    // rather than Drizzle's db.values().
    const d1 = getD1(event)
    const { results } = await d1.prepare('SELECT filename FROM _nuxflow_migrations ORDER BY filename ASC').all<{ filename: string }>()
    const applied = new Set(results.map(r => r.filename))

    let count = 0
    for (const key of keys) {
      if (applied.has(key)) continue
      const content = await storage.getItem<string>(key)
      if (!content) continue
      for (const stmt of content.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) {
        try {
          await db.run(sql.raw(stmt))
        } catch (err) {
          // Skip statements that were already applied (partial retry after prior failure).
          const errMsg = String(err).toLowerCase()
          const causeMsg = err instanceof Error && err.cause ? String(err.cause).toLowerCase() : ''
          if (
            errMsg.includes('already exists') ||
            errMsg.includes('duplicate column') ||
            causeMsg.includes('already exists') ||
            causeMsg.includes('duplicate column')
          ) continue
          throw err
        }
      }
      await db.run(sql`INSERT INTO _nuxflow_migrations (filename) VALUES (${key})`)
      count++
    }

    if (count > 0) console.warn(`[nuxflow:migrate] Applied ${count} migration(s)`)
  } finally {
    await releaseMigrationLock(db)
  }
}
