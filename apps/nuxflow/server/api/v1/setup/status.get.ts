import { useDb } from '../../../utils/db'
import { sites, users } from '@nuxflow/db/schema'
import { count, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
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

    let host = getHeader(event, 'host')?.split(':')[0] ?? ''
    if (host === '127.0.0.1' || host === '::1') {
      host = 'localhost'
    }

    if (hasSite) {
      // Look up the site matching the active request host domain
      let site = await db.query.sites.findFirst({
        where: eq(sites.domain, host),
      })

      // Fallback: If no site matches this domain but there is exactly 1 site in DB, use it (single site mode)
      if (!site && siteCount?.value === 1) {
        site = await db.query.sites.findFirst()
      } else if (!site && (siteCount?.value ?? 0) > 1 && (host === 'localhost' || host.endsWith('.workers.dev'))) {
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

    return {
      hasSite,
      hasAdmin,
      setupCompleted,
      needsSetup: !hasSite || !hasAdmin || !setupCompleted,
      site: hasSite ? { name: siteName, domain: siteDomain, locale: siteLocale, timezone: siteTimezone } : null,
    }
  } catch {
    // DB schema not yet migrated — report as needing setup.
    return { hasSite: false, hasAdmin: false, setupCompleted: false, needsSetup: true, site: null }
  }
})
