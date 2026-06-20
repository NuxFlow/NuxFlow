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
  // useEvent() throws when called outside a request context (e.g. scheduled tasks).
  // Isolate it so the globalThis.__env__ fallback is always reachable.
  let eventD1: unknown
  // eslint-disable-next-line no-empty
  try { eventD1 = (event ?? useEvent())?.context?.cloudflare?.env?.DB } catch {}

  // In scheduled tasks Nitro sets globalThis.__env__ to the Cloudflare bindings
  // object before firing the cloudflare:scheduled hook, so DB is available there.
  const cfGlobal = globalThis as { __env__?: { DB?: unknown } }
  const d1 = eventD1 ?? cfGlobal.__env__?.DB ?? _d1

  if (d1) {
    _d1 ??= d1
    return drizzle(d1, { schema }) as unknown as Db
  }

  if (_tursoDb) return _tursoDb
  const config = useRuntimeConfig()
  if (!config.tursoUrl) {
    throw createError({ statusCode: 500, message: 'No database configured. Bind a D1 database (DB) or set NUXT_TURSO_URL.' })
  }
  _tursoDb = createDb(config.tursoUrl, config.tursoAuthToken || undefined)
  return _tursoDb
}
