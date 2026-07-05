import type { H3Event } from 'h3'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@nuxflow/db/schema'

export type Db = ReturnType<typeof drizzle<typeof schema>>

// Module-level D1 binding cache — stable within a CF Workers isolate.
// Populated by useDb(event) on first request (via the 01.d1-cache middleware),
// then readable by auth.config.ts which has no per-request event access.
let _d1: unknown = null
export function getD1(): unknown { return _d1 }

// Pass the H3Event explicitly so Cloudflare D1 binding is always accessible —
// useEvent() does not reliably propagate event context in CF Workers utility functions.
//
// Future (multi-DB sharding): event.context.shardIndex (number) is the reserved field
// for selecting which D1 binding to use. When sharding is implemented this function
// will read that value and return drizzle(env['DB' + shardIndex], ...) for index > 0.
// See docs/roadmap.md — "Multi-DB Sharding" for the full design.
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

  if (!d1) {
    throw createError({
      statusCode: 500,
      message: 'No D1 database bound. Add a [[d1_databases]] block to wrangler.toml and run via `wrangler dev` (local) or a real deploy — D1 is provisioned automatically either way.',
    })
  }

  _d1 ??= d1
  return drizzle(d1, { schema })
}
