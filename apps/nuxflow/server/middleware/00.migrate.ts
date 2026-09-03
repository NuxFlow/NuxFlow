import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from '../utils/db'
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
async function waitForMigrationsToComplete(db: ReturnType<typeof useDb>, expectedKeys: string[]): Promise<boolean> {
  for (let attempt = 0; attempt < MIGRATION_WAIT_POLL_ATTEMPTS; attempt++) {
    try {
      const rows = await db.values<[string]>(
        sql`SELECT filename FROM _nuxflow_migrations`,
      )
      const applied = new Set(rows.map(r => r[0]))
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
    const winnerDone = await waitForMigrationsToComplete(db, keys)
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

    const rows = await db.values<[string]>(
      sql`SELECT filename FROM _nuxflow_migrations ORDER BY filename ASC`,
    )
    const applied = new Set(rows.map(r => r[0]))

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
