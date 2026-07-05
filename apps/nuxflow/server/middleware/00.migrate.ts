import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from '../utils/db'

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
      console.error('[nuxflow:migrate]', err instanceof Error ? err.message : err)
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

async function applyMigrations(event: H3Event) {
  const storage = useStorage('assets/migrations')
  const keys = (await storage.getKeys()).filter(k => !k.startsWith('meta:')).sort()
  if (!keys.length) return

  const db = useDb(event)

  const acquired = await acquireMigrationLock(db)
  if (!acquired) {
    // Another isolate is already migrating (or crashed mid-migration and the lock
    // hasn't gone stale yet). Don't block this request indefinitely — the schema is
    // very likely already in, or about to be in, the state the other isolate is
    // bringing it to.
    console.warn('[nuxflow:migrate] Another isolate holds the migration lock — skipping')
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
