import { useDb } from '../../../utils/db'
import { sites, users } from '@nuxflow/db/schema'
import { count, eq } from 'drizzle-orm'
import { createIsolateCache } from '../../../utils/isolate-cache'

type SetupStatus = {
  hasSite: boolean
  hasAdmin: boolean
  setupCompleted: boolean
  needsSetup: boolean
  site: { name: string; domain: string; locale: string; timezone: string } | null
}

// app/middleware/00.setup-guard.global.ts calls this route once per SSR render (its own
// useState cache resets every request), so this used to pay 2 count() scans plus a site
// lookup on *every single page view of every site*, forever — setup normally completes
// once and never reverts, so almost all of that cost bought nothing. Only the "fully set
// up" result is cached (a fresh/in-progress install still gets a live check on every
// request, since that flow is low-traffic and needs to react immediately as it
// progresses); setup/complete.post.ts clears the entry for its host so the wizard's own
// redirect away from /setup isn't stuck behind the TTL.
const _statusCache = createIsolateCache<SetupStatus>(60_000)

export function clearSetupStatusCache(host?: string): void {
  if (host) _statusCache.delete(host)
  else _statusCache.clear()
}

export default defineEventHandler(async (event) => {
  let cacheHost = getHeader(event, 'host')?.split(':')[0] ?? ''
  if (cacheHost === '127.0.0.1' || cacheHost === '::1') cacheHost = 'localhost'

  const cached = _statusCache.get(cacheHost)
  if (cached) return cached

  const db = useDb(event)

  try {
    const [siteCount] = await db.select({ value: count() }).from(sites)
    const [userCount] = await db.select({ value: count() }).from(users)

    const hasSite = (siteCount?.value ?? 0) > 0
    const hasAdmin = (userCount?.value ?? 0) > 0

    let setupCompleted = false
    let siteName = ''
    let siteDomain = ''
    let siteLocale = 'en'
    let siteTimezone = 'UTC'

    if (hasSite) {
      // Look up the site matching the active request host domain
      let site = await db.query.sites.findFirst({
        where: eq(sites.domain, cacheHost),
      })

      // Fallback: If no site matches this domain but there is exactly 1 site in DB, use it (single site mode)
      if (!site && siteCount?.value === 1) {
        site = await db.query.sites.findFirst()
      } else if (!site && (siteCount?.value ?? 0) > 1 && (cacheHost === 'localhost' || cacheHost.endsWith('.workers.dev'))) {
        // Local/Preview fallback: default to the first site in D1
        site = await db.query.sites.findFirst()
      }

      if (site) {
        setupCompleted = site.setupCompleted ?? false
        siteName = site.name ?? ''
        siteDomain = site.domain ?? ''
        siteLocale = site.locale ?? 'en'
        siteTimezone = site.timezone ?? 'UTC'
      }
    }

    const result: SetupStatus = {
      hasSite,
      hasAdmin,
      setupCompleted,
      needsSetup: !hasSite || !hasAdmin || !setupCompleted,
      site: hasSite ? { name: siteName, domain: siteDomain, locale: siteLocale, timezone: siteTimezone } : null,
    }
    if (!result.needsSetup) _statusCache.set(cacheHost, result)
    return result
  } catch {
    // DB schema not yet migrated — report as needing setup.
    return { hasSite: false, hasAdmin: false, setupCompleted: false, needsSetup: true, site: null }
  }
})
