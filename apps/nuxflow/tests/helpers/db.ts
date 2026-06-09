/**
 * Test database factory.
 * Creates a fresh file-based SQLite database, runs all Drizzle migrations in
 * order, and exposes a Drizzle instance that integration tests can use via
 * getCurrentTestDb().
 */

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '@nuxflow/db/schema'
import { readdir, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export type TestDb = ReturnType<typeof drizzle<typeof schema>>

let _currentDb: TestDb | null = null
let _currentDbPath: string | null = null

export function getCurrentTestDb(): TestDb {
  if (!_currentDb) throw new Error('Test DB not initialized — call initTestDb() in beforeAll()')
  return _currentDb
}

/**
 * Creates a fresh in-memory-backed SQLite file, runs all migrations and
 * returns the Drizzle instance. Call in beforeAll(); call teardownTestDb() in afterAll().
 */
export async function initTestDb(): Promise<TestDb> {
  const dbPath = join(tmpdir(), `nuxflow-test-${randomUUID()}.db`)
  const dbUrl = `file:${dbPath.replace(/\\/g, '/')}`

  const client = createClient({ url: dbUrl })
  const db = drizzle(client, { schema })

  await runMigrations(db)

  _currentDb = db
  _currentDbPath = dbPath
  return db
}

export async function teardownTestDb(): Promise<void> {
  _currentDb = null
  if (_currentDbPath) {
    await unlink(_currentDbPath).catch(() => {})
    _currentDbPath = null
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../packages/db/migrations', import.meta.url),
)

async function runMigrations(db: TestDb): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql') && !f.startsWith('meta'))
    .sort()

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS _nuxflow_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)

  for (const file of files) {
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8')
    const statements = content
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(Boolean)

    for (const stmt of statements) {
      try {
        await db.run(sql.raw(stmt))
      } catch (err) {
        const msg = String(err).toLowerCase()
        const causeMsg = err instanceof Error && err.cause ? String(err.cause).toLowerCase() : ''
        if (
          msg.includes('already exists') ||
          msg.includes('duplicate column') ||
          causeMsg.includes('already exists') ||
          causeMsg.includes('duplicate column')
        ) {
          continue
        }
        throw err
      }
    }

    await db.run(sql`INSERT OR IGNORE INTO _nuxflow_migrations (filename) VALUES (${file})`)
  }
}
