import { redirects } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { createIsolateCache } from './isolate-cache'
import type { Db } from './db'

type RedirectEntry = { to: string; statusCode: number }
type RedirectMap = Map<string, RedirectEntry>

// A site's whole redirect table is loaded once and cached per-isolate, rather than one
// `WHERE siteId = ? AND from = ?` lookup per request. Two call sites need this exact fact
// on every single public page view — server/middleware/05.redirects.ts (every non-API/
// non-admin navigation) and server/api/public/pages/[...slug].get.ts's own route handler
// (direct/headless API callers, which the middleware skips) — so without a shared cache
// the same row was being fetched from D1 twice per browser page load. 30s matches the
// site-domain cache TTL in 02.multi-site.ts; redirect create/delete routes clear the
// affected site's entry immediately so a same-isolate caller never has to wait out the TTL.
const _cache = createIsolateCache<RedirectMap>(30_000)

export function clearRedirectCache(siteId?: string): void {
  if (siteId) _cache.delete(siteId)
  else _cache.clear()
}

/**
 * Canonical form of a redirect's `from` path, applied both when a rule is saved and when
 * a request is matched: query string and fragment dropped, trailing slash removed (except
 * for `/` itself), and lower-cased — so `/Old-Page/` and `/old-page?utm=x` both hit a
 * `/old-page` rule.
 */
export function normalizeRedirectPath(path: string): string {
  let p = path.split(/[?#]/, 1)[0] ?? ''
  try {
    p = decodeURI(p)
  } catch { /* keep as-is when malformed */ }
  if (!p.startsWith('/')) p = `/${p}`
  p = p.replace(/\/{2,}/g, '/')
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return p.toLowerCase()
}

/** Carries the incoming query string over to a target that doesn't set its own. */
export function redirectTarget(to: string, search: string): string {
  if (!search || to.includes('?')) return to
  const hashIndex = to.indexOf('#')
  return hashIndex === -1 ? `${to}${search}` : `${to.slice(0, hashIndex)}${search}${to.slice(hashIndex)}`
}

async function loadRedirectMap(db: Db, siteId: string): Promise<RedirectMap> {
  const cached = _cache.get(siteId)
  if (cached) return cached

  const rows = await db.query.redirects.findMany({
    where: eq(redirects.siteId, siteId),
    columns: { from: true, to: true, statusCode: true },
  })
  const map: RedirectMap = new Map(rows.map(r => [normalizeRedirectPath(r.from), { to: r.to, statusCode: r.statusCode }]))
  _cache.set(siteId, map)
  return map
}

/** Looks up a redirect for a request path (normalized — see normalizeRedirectPath). */
export async function findRedirect(db: Db, siteId: string, path: string): Promise<RedirectEntry | null> {
  const map = await loadRedirectMap(db, siteId)
  return map.get(normalizeRedirectPath(path)) ?? null
}
