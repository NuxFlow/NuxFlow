import { useDb } from '../../../utils/db'
import { sites, users } from '@nuxflow/db/schema'
import { count, eq } from 'drizzle-orm'
import { cacheSetupStatus, getCachedSetupStatus, type SetupStatus } from '../../../utils/setup-status'
import { getCfBindings } from '../../../utils/cf-env'
import { isMemberPool } from '../../../utils/control-plane'

export default defineEventHandler(async (event) => {
  // A member pool is never set up through the wizard: its sites are created by the
  // control plane (utils/control-plane.ts), and an empty pool must not look like a fresh install.
  if (isMemberPool()) {
    return { hasSite: false, hasAdmin: false, setupCompleted: true, needsSetup: false, site: null, mediaStorage: getCfBindings(event).r2 ? 'r2' : 'none' } satisfies SetupStatus
  }

  let cacheHost = getHeader(event, 'host')?.split(':')[0] ?? ''
  if (cacheHost === '127.0.0.1' || cacheHost === '::1') cacheHost = 'localhost'

  const cached = getCachedSetupStatus(cacheHost)
  if (cached) return cached

  const db = useDb(event)

  try {
    const [siteCount] = await db.select({ value: count() }).from(sites)
    const [userCount] = await db.select({ value: count() }).from(users)

    const hasSite = (siteCount?.value ?? 0) > 0
    const hasAdmin = (userCount?.value ?? 0) > 0

    let setupCompleted = false
    let unknownHost = false
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
        // Local/Preview fallback: the primary site, matching 02.multi-site.ts
        site = await db.query.sites.findFirst({ orderBy: (s, { desc, asc }) => [desc(s.isPrimary), asc(s.createdAt)] })
      }

      // Several sites, none on this host: nothing here to set up (02.multi-site.ts serves
      // a 404 for it). A secondary site awaiting setup always has its own row.
      if (!site) unknownHost = true

      if (site) {
        setupCompleted = site.setupCompleted ?? false
        siteName = site.name ?? ''
        siteDomain = site.domain ?? ''
        siteLocale = site.locale ?? 'en'
        siteTimezone = site.timezone ?? 'UTC'
      }
    }

    const result: SetupStatus = {
      mediaStorage: getCfBindings(event).r2 ? 'r2' : 'none',
      hasSite,
      hasAdmin,
      setupCompleted,
      needsSetup: !hasSite || !hasAdmin || (!unknownHost && !setupCompleted),
      site: hasSite ? { name: siteName, domain: siteDomain, locale: siteLocale, timezone: siteTimezone } : null,
    }
    // Never cache an unknown host: a site can be created for it at any moment, and its
    // setup link must work straight away on every isolate.
    if (!result.needsSetup && !unknownHost) cacheSetupStatus(cacheHost, result)
    return result
  } catch {
    // DB schema not yet migrated — report as needing setup.
    return { hasSite: false, hasAdmin: false, setupCompleted: false, needsSetup: true, site: null, mediaStorage: getCfBindings(event).r2 ? 'r2' : 'none' }
  }
})
