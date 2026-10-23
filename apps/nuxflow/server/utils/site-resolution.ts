import type { H3Event } from 'h3'
import { siteDomains, sites } from '@nuxflow/db/schema'
import { eq, sql } from 'drizzle-orm'
import { useDb } from './db'
import { createIsolateCache } from './isolate-cache'
import { clearSiteInfoCache } from './site-info'
import { isMemberPool } from './control-plane'
import { getUserSiteRole, roleAtLeast, type Role } from './permissions'

// getAuthSession is deliberately called as a Nitro auto-import (not an explicit import
// from './auth') — every other call site in this codebase does the same (see
// permissions.ts's requireAuth calling requireSession the same way), and the test harness
// mocks it via globalThis rather than vi.mock() on that module path. An explicit import
// bypasses that mock and calls the real getOrCreateBetterAuth(), which has no Cloudflare
// bindings available outside a real Worker/Wrangler context.

// `redirectTo` is set when the host is one of the site's extra addresses (site_domains —
// a customer's own domain, or the original subdomain after the site moved to its own
// domain): requests there redirect to the main address.
export type SiteLookup = { id: string; status: 'active' | 'maintenance' | 'suspended'; setupCompleted: boolean; domain?: string; redirectTo?: string; moveState?: string | null }

// Per-isolate cache: domain -> site rarely changes (only admin site
// create/update/delete, or the self-healing domain migration below), but
// without this every single request — public page, admin, API — paid a full
// D1 round trip for it before any other logic ran. Cached "no site found for
// this host" is stored as `null` (a real cached value) rather than `undefined`
// (which createIsolateCache also returns for "nothing cached yet") so a
// never-onboarded domain doesn't defeat the cache on every request.
const _siteCache = createIsolateCache<SiteLookup | null>(30_000)
// Hosts that match no site while several sites exist (see below) — distinct from a cached
// `null`, which on a fresh install still means "go to setup". Short-lived: a super admin can
// create a site for one of these hosts at any moment, and clearSiteCache() only reaches the
// isolate that created it, so its setup link must not 404 elsewhere for long. Still enough
// to spare D1 from a burst of hits on a junk subdomain.
const _unknownHostCache = createIsolateCache<true>(5_000)

export function clearSiteCache(host?: string): void {
  if (host) {
    _siteCache.delete(host)
    _unknownHostCache.delete(host)
  } else {
    _siteCache.clear()
    _unknownHostCache.clear()
  }
  clearSiteInfoCache()
}

/**
 * Finds the site a request's `Host` serves — by domain, then by one of a site's extra
 * addresses, then the single-site / preview fallbacks (control plane only). Cached per
 * isolate. `unknownHost` means several sites exist and none is served here.
 */
export async function resolveSiteForHost(event: H3Event, host: string, path: string): Promise<{ site: SiteLookup | undefined; unknownHost: boolean }> {
  const cached = _siteCache.get(host)
  let site: SiteLookup | undefined
  let unknownHost = false
  if (_unknownHostCache.get(host)) {
    unknownHost = true
  } else if (cached !== undefined) {
    site = cached ?? undefined
  } else {
    const db = useDb(event)
    try {
      site = await db.query.sites.findFirst({
        where: eq(sites.domain, host),
        columns: { id: true, status: true, setupCompleted: true, domain: true, moveState: true },
      })
      // A copy still being written by a move between pools (utils/site-move.ts) is served nowhere.
      if (site?.moveState === 'incoming') site = undefined

      // One of a site's extra addresses: resolve to that site; middleware/02.multi-site.ts redirects to the main one.
      if (!site) {
        const [alias] = await db.select({ id: sites.id, status: sites.status, setupCompleted: sites.setupCompleted, domain: sites.domain, moveState: sites.moveState })
          .from(siteDomains)
          .innerJoin(sites, eq(sites.id, siteDomains.siteId))
          .where(eq(siteDomains.hostname, host))
          .limit(1)
        if (alias && alias.moveState !== 'incoming') site = { ...alias, redirectTo: alias.domain }
      }

      // A member pool only ever serves the addresses its sites own (utils/control-plane.ts):
      // none of the fallbacks below. A pool holding a single client's site would otherwise
      // answer any stray hostname as that site — and its admin's visit would even rewrite
      // the site's stored domain — while an empty pool would offer the setup wizard.
      if (!site && isMemberPool()) {
        unknownHost = true
      } else if (!site) {
        // Resilient Fallback: If no site matches the request domain but there is
        // exactly one site in D1, use that site. This prevents locking the user
        // out of their admin dashboard when migrating from localhost/.workers.dev to a custom domain.
        const allSites = (await db.query.sites.findMany({
          columns: { id: true, status: true, setupCompleted: true, domain: true, moveState: true },
          // Primary (operator's) site first, then oldest — so the preview fallback below
          // is deterministic instead of whichever row the table scan returns first.
          orderBy: (s, { desc, asc }) => [desc(s.isPrimary), asc(s.createdAt)],
        })).filter(s => s.moveState !== 'incoming' && s.moveState !== 'moved')
        if (allSites.length === 1) {
          site = allSites[0]!

          // Self-Healing Domain Migration: If this is a public domain in production,
          // automatically update the database record to match the active request host.
          // This ensures sitemaps, RSS feeds, and user invite email links heal automatically!
          //
          // Gated to /admin traffic AND an authenticated admin+ session on this exact
          // site. `Host` is fully attacker-controlled on a Worker reachable at its raw
          // *.workers.dev hostname (no custom-domain route configured), and this
          // middleware runs before auth — without the session check, an unauthenticated
          // request with a forged Host header could silently rewrite sites.domain to
          // arbitrary attacker-chosen text, which every SEO surface (feed/sitemap/
          // robots.txt) and every invite email then treats as trusted. A real operator
          // navigating the dashboard on the new domain while signed in is a plausible
          // deliberate migration; nothing else is.
          if (path.startsWith('/admin') && host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && site.domain !== host) {
            // Isolated from the outer try/catch on purpose: that catch treats any
            // failure as "DB not yet migrated" and nulls out siteId for the whole
            // request. A session-check failure here (Better Auth misconfigured, no
            // session cookie, etc.) must only skip the self-heal — it must never take
            // down site resolution for the entire request.
            try {
              const session = await getAuthSession(event)
              if (session) {
                const roleRow = await getUserSiteRole(db, session.user.id, site.id)
                const role = (roleRow?.role ?? 'viewer') as Role
                if (roleAtLeast(role, 'admin')) {
                  await db.update(sites)
                    .set({ domain: host, updatedAt: sql`(datetime('now'))` })
                    .where(eq(sites.id, site.id))
                  clearSiteCache()
                }
              }
            } catch (err) {
              console.error('[multi-site] Skipping domain self-heal — session check failed', err)
            }
          }
        } else if (allSites.length > 1 && (host === 'localhost' || host.endsWith('.workers.dev'))) {
          // Local/Preview fallback: the primary site (see ordering above)
          site = allSites[0]!
        } else if (allSites.length > 1) {
          // Several sites, none on this host — e.g. www.example.com or a typo'd subdomain
          // reaching a wildcard route. This used to fall through as "setup not completed",
          // so the visitor landed on a /setup wizard they could never finish (no token).
          unknownHost = true
        }
      }
      if (unknownHost) _unknownHostCache.set(host, true)
      else _siteCache.set(host, site ?? null)
    } catch {
      // DB not yet migrated — treat as no site so the setup guard can redirect.
      // Not cached, so the next request retries once migrations complete.
      site = undefined
    }
  }

  return { site, unknownHost }
}
