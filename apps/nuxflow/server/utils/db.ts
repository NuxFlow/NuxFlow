import type { H3Event } from 'h3'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '@nuxflow/db/schema'

export type Db = ReturnType<typeof drizzle<typeof schema>>

// Module-level D1 binding cache — stable within a CF Workers isolate.
// Populated by useDb(event) on first request (via the 01.d1-cache middleware)
// so later calls (e.g. from scheduled tasks with no live event) can still
// find a binding via the globalThis fallback below.
let _d1: unknown = null

// Pass the H3Event explicitly so Cloudflare D1 binding is always accessible —
// useEvent() does not reliably propagate event context in CF Workers utility functions.
export function useDb(event?: H3Event): Db {
  const d1 = resolveD1Binding(event)
  // d1 is read from several untyped sources in resolveD1Binding (event context, globalThis
  // fallback, module cache) — TS can't prove it's a real D1Database through that chain, but
  // the caller-facing guarantee (throw inside resolveD1Binding if absent) is the actual
  // safety check.
  return drizzle(d1 as D1Database, { schema })
}

// Read-replica Drizzle instance for anonymous, read-only, latency-insensitive-to-staleness
// public GET routes (published pages/posts, taxonomy archives, site chrome, search) — see
// the "D1 read replication" section of CLAUDE.md for the full reasoning and the list of
// routes that use this vs. useDb().
//
// D1 Read Replication (a paid add-on, enabled per-database via the dashboard or the REST
// API — there is no wrangler.toml setting for it) does NOT use a second binding. It's
// accessed through `D1Database.withSession(constraintOrBookmark)` on the *same* `DB`
// binding: https://developers.cloudflare.com/d1/best-practices/read-replication/. The
// returned `D1DatabaseSession` exposes the same `prepare()`/`batch()` shape `D1Database`
// does (confirmed against this project's own generated worker-configuration.d.ts), which
// is all drizzle-orm's D1 driver ever calls — so wrapping a session in `drizzle()` works
// exactly like wrapping the primary binding, just routed differently by Cloudflare.
//
// 'first-unconstrained' (not 'first-primary' or a bookmark) is used deliberately: it lets
// even the *first* query in the session go to a nearby replica rather than forcing a
// primary round trip first, matching Cloudflare's own guidance ("best when latest data
// isn't required") for exactly this use case — anonymous visitors reading published
// content, where a 100ms-2s replication lag is imperceptible and never a correctness
// issue. No bookmark is threaded between requests (no read-your-writes guarantee) because
// nothing that reads via this helper is a page a writer is likely to reload within that
// window as a *different* anonymous request — an editor previewing their own unpublished
// change already goes through the authenticated admin API on the primary, not this path.
//
// Where read replication isn't enabled on the database (most deployments, since it's an
// opt-in paid add-on) or isn't available (`wrangler dev` locally — sessions still work per
// Cloudflare's own docs, they just don't distribute to replicas), `withSession()` is a
// no-op wrapper that routes to the primary anyway — so this is always safe to call
// regardless of plan/environment, and starts paying off the moment an operator enables it.
export function useReplicaDb(event?: H3Event): Db {
  const d1 = resolveD1Binding(event)
  const session = (d1 as D1Database).withSession('first-unconstrained')
  return drizzle(session as unknown as D1Database, { schema })
}

function resolveD1Binding(event?: H3Event): unknown {
  // useEvent() throws when called outside a request context (e.g. scheduled tasks).
  // Isolate it so the globalThis.__env__ fallback is always reachable.
  let eventD1: unknown
  // eslint-disable-next-line no-empty
  try { eventD1 = (event ?? useEvent())?.context?.cloudflare?.env?.DB } catch {}

  const cfGlobal = globalThis as { __env__?: { DB?: unknown } }
  const d1 = eventD1 ?? cfGlobal.__env__?.DB ?? _d1

  if (!d1) {
    throw createError({
      statusCode: 500,
      message: 'No D1 database bound. Add a [[d1_databases]] block to wrangler.toml and run via `wrangler dev` (local) or a real deploy — D1 is provisioned automatically either way.',
    })
  }

  _d1 ??= d1
  return d1
}

// Raw D1Database binding, bypassing Drizzle — for code that needs direct SQL access
// Drizzle's query builder doesn't expose (schema introspection via sqlite_master/PRAGMA,
// e.g. the whole-database SQL export in d1-export.ts). Shares useDb()'s binding
// resolution (event context, then the scheduled-task globalThis fallback) rather than
// duplicating it.
export function getD1(event?: H3Event): D1Database {
  useDb(event) // populates _d1 via the resolution chain above; throws the same clear error if unbound
  return _d1 as D1Database
}
