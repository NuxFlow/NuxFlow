// Per-isolate cache for a user's site role (requireAuth's userSiteRoles lookup), which
// otherwise pays one D1 round trip on every single authenticated API call — unlike the
// site-domain lookup in 02.multi-site.ts, it had no isolate cache at all.
//
// TTL is deliberately much shorter than the site-domain cache (30s) or appearance cache
// (60s): a stale role here has a security-downgrade angle a stale site lookup doesn't —
// access revoked via [id].delete.ts or downgraded via [id].patch.ts should take effect
// close to immediately, not linger for tens of seconds. 10s bounds the cross-isolate
// staleness window to something acceptable while still absorbing the common case (a user
// issuing several API calls in quick succession). Every direct role-mutation route
// (patch/delete/super-admin grant+revoke/invite) also explicitly evicts the affected
// entry on write, so same-isolate callers see the change immediately regardless of TTL —
// the TTL alone only has to cover *other* isolates.
import { createIsolateCache } from './isolate-cache'
import type { Role } from './permissions'

const cache = createIsolateCache<Role | null>(10_000)

function cacheKey(userId: string, siteId: string): string {
  return `${userId}:${siteId}`
}

export function getCachedRole(userId: string, siteId: string): Role | null | undefined {
  return cache.get(cacheKey(userId, siteId))
}

export function setCachedRole(userId: string, siteId: string, role: Role | null): void {
  cache.set(cacheKey(userId, siteId), role)
}

/** Call after any write to a user's user_site_roles row for (userId, siteId). */
export function clearCachedRole(userId: string, siteId: string): void {
  cache.delete(cacheKey(userId, siteId))
}
