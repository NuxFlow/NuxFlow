import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from '../utils/db'

// One promise per Worker isolate — all concurrent requests share it so migrations
// only run once. Reset to null on failure so the next cold start retries.
let _migrationPromise: Promise<void> | null = null

export default defineEventHandler(async (event) => {
  if (!_migrationPromise) {
    _migrationPromise = applyMigrations(event).catch((err) => {
      console.error('[nuxflow:migrate]', err instanceof Error ? err.message : err)
      _migrationPromise = null
    })
  }
  await _migrationPromise
})

async function applyMigrations(event: H3Event) {
  const storage = useStorage('assets/migrations')
  const keys = (await storage.getKeys()).filter(k => !k.startsWith('meta:')).sort()
  if (!keys.length) return

  const db = useDb(event)

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS _nuxflow_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)

  const rows = await db.values<[string][]>(
    sql`SELECT filename FROM _nuxflow_migrations ORDER BY filename ASC`,
  )
  const applied = new Set(rows.map(r => r[0]))

  // If the tracking table is empty but the schema already exists (e.g. a prior
  // manual wrangler d1 execute install), seed the tracking table for the base schema
  // and let any subsequent migrations run normally to update the tables.
  if (applied.size === 0 && await tableExists(db, 'sites')) {
    const baseMigration = '0000_majestic_cannonball.sql'
    await db.run(sql`INSERT OR IGNORE INTO _nuxflow_migrations (filename) VALUES (${baseMigration})`)
    applied.add(baseMigration)
    console.warn('[nuxflow:migrate] Pre-existing schema detected — base migration tracking seeded')
  }

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
        if (String(err).toLowerCase().includes('already exists')) continue
        throw err
      }
    }
    await db.run(sql`INSERT INTO _nuxflow_migrations (filename) VALUES (${key})`)
    count++
  }

  if (count > 0) console.warn(`[nuxflow:migrate] Applied ${count} migration(s)`)
}

async function tableExists(db: ReturnType<typeof useDb>, table: string): Promise<boolean> {
  try {
    await db.run(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`)
    return true
  } catch {
    return false
  }
}
