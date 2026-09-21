import { redirects } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { createIsolateCache } from './isolate-cache'
import type { Db } from './db'

type RedirectEntry = { to: string; statusCode: number }
type RedirectMap = Map<string, RedirectEntry>

// A site's whole redirect table is loaded once and cached per-isolate, rather than one
// `WHERE siteId = ? AND from = ?` lookup per request. Two call sites need this exact fact
// on every single public page view — server/middleware/05.redirects.ts (every non-API/
// non-admin navigation) and server/api/public/pages/[slug].get.ts's own route handler
// (direct/headless API callers, which the middleware skips) — so without a shared cache
// the same row was being fetched from D1 twice per browser page load. 30s matches the
// site-domain cache TTL in 02.multi-site.ts; redirect create/delete routes clear the
// affected site's entry immediately so a same-isolate caller never has to wait out the TTL.
const _cache = createIsolateCache<RedirectMap>(30_000)

export function clearRedirectCache(siteId?: string): void {
  if (siteId) _cache.delete(siteId)
  else _cache.clear()
}

async function loadRedirectMap(db: Db, siteId: string): Promise<RedirectMap> {
  const cached = _cache.get(siteId)
  if (cached) return cached

  const rows = await db.query.redirects.findMany({
    where: eq(redirects.siteId, siteId),
    columns: { from: true, to: true, statusCode: true },
  })
  const map: RedirectMap = new Map(rows.map(r => [r.from, { to: r.to, statusCode: r.statusCode }]))
  _cache.set(siteId, map)
  return map
}

/** Looks up a redirect for an exact `from` path (e.g. `/old-page`). */
export async function findRedirect(db: Db, siteId: string, path: string): Promise<RedirectEntry | null> {
  const map = await loadRedirectMap(db, siteId)
  return map.get(path) ?? null
}
