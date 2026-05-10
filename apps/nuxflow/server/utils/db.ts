import type { H3Event } from 'h3'
import { createDb, type Db } from '@nuxflow/db/client'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@nuxflow/db/schema'

let _tursoDb: Db | null = null

// Module-level D1 binding cache — stable within a CF Workers isolate.
// Populated by useDb(event) on first request (via the 01.d1-cache middleware),
// then readable by auth.config.ts which has no per-request event access.
let _d1: unknown = null
export function getD1(): unknown { return _d1 }

// Explicit return type Db (LibSQL-based alias) so callers see a single consistent
// type. The D1 drizzle instance is runtime-compatible and cast accordingly.
// Pass the H3Event explicitly so Cloudflare D1 binding is always accessible —
// useEvent() does not reliably propagate event context in CF Workers utility functions.
export function useDb(event?: H3Event): Db {
  try {
    const d1 = (event ?? useEvent())?.context?.cloudflare?.env?.DB ?? _d1
    if (d1) {
      _d1 ??= d1
      return drizzle(d1, { schema }) as unknown as Db
    }
  }
  // eslint-disable-next-line no-empty
  catch {}

  if (_tursoDb) return _tursoDb
  const config = useRuntimeConfig()
  if (!config.tursoUrl) {
    throw createError({ statusCode: 500, message: 'No database configured. Bind a D1 database (DB) or set NUXT_TURSO_URL.' })
  }
  _tursoDb = createDb(config.tursoUrl, config.tursoAuthToken || undefined)
  return _tursoDb
}
