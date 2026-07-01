import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from '../utils/db'
import { demoFirstBoot } from '../scheduled/demo-reset'

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

  const rows = await db.values<[string]>(
    sql`SELECT filename FROM _nuxflow_migrations ORDER BY filename ASC`,
  )
  const applied = new Set(rows.map(r => r[0]))

  // If the tracking table is empty but the schema already exists (e.g. a prior
  // manual wrangler d1 execute install), seed the tracking table for the base schema
  // and let any subsequent migrations run normally to update the tables.
  if (applied.size === 0 && await tableExists(db, 'sites')) {
    const baseMigration = '0000_baseline.sql'
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

  // For demo instances: seed on cold start so the site is immediately usable
  // without waiting up to 60 s for the first cron tick.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDemo = useRuntimeConfig().isDemo === true || (globalThis as any).__env__?.NUXT_IS_DEMO === 'true'
  if (isDemo) {
    await demoFirstBoot()
  }
}

async function tableExists(db: ReturnType<typeof useDb>, table: string): Promise<boolean> {
  try {
    await db.run(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`)
    return true
  } catch {
    return false
  }
}
