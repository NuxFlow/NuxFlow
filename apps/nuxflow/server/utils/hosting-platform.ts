import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { siteSettings, sites } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { createIsolateCache } from './isolate-cache'
import { isMemberPool } from './control-plane'

/**
 * "Run this install as a hosting platform" — one switch, off by default, stored as a
 * setting on the primary site (the operator's own). Off, a single-site or self-hosted
 * install never meets hosting plans: every site is on the built-in unlimited plan, the
 * plan alerts don't run, and Super Admin → Plans/Usage are hidden (their APIs 404). On,
 * plans and limits apply and the hosting pages appear.
 *
 * Server-managed (SERVER_MANAGED_SETTING_KEYS): only `PUT /api/v1/admin/platform`
 * (super admin) writes it — never the settings PATCH, a backup, or a theme demo, so a
 * primary-site admin who isn't the operator can't flip it and a restore can't carry it
 * to another deployment.
 */
export const HOSTING_PLATFORM_SETTING_KEY = 'platform.hosting_enabled'

// Read on every plan lookup, so cached per isolate; other isolates notice a change
// within the TTL, the isolate that made it immediately.
const cache = createIsolateCache<boolean>(60_000)

export function clearHostingPlatformCache(): void {
  cache.clear()
}

export async function isHostingPlatform(db: Db): Promise<boolean> {
  // Pools only exist on a hosting platform, and a pool has no primary site to hold the switch.
  if (isMemberPool()) return true
  const cached = cache.get('enabled')
  if (cached !== undefined) return cached
  const [row] = await db.select({ value: siteSettings.value })
    .from(siteSettings)
    .innerJoin(sites, eq(sites.id, siteSettings.siteId))
    .where(and(eq(sites.isPrimary, true), eq(siteSettings.key, HOSTING_PLATFORM_SETTING_KEY)))
    .limit(1)
  const enabled = row?.value === true || row?.value === 'true'
  cache.set('enabled', enabled)
  return enabled
}

/**
 * "Pause new hosting sign-ups" — also server-managed, on the primary site, set from Super
 * Admin → Platform. Stored as *closed* so that unset (every install so far) means open.
 * It only stops new accounts and new checkouts on the sign-up page: existing customers
 * keep My hosting, billing, plan changes and their domains.
 */
export const HOSTING_SIGNUPS_CLOSED_KEY = 'platform.hosting_signups_closed'

export async function hostingSignupsOpen(db: Db): Promise<boolean> {
  const cached = cache.get('signupsOpen')
  if (cached !== undefined) return cached
  const [row] = await db.select({ value: siteSettings.value })
    .from(siteSettings)
    .innerJoin(sites, eq(sites.id, siteSettings.siteId))
    .where(and(eq(sites.isPrimary, true), eq(siteSettings.key, HOSTING_SIGNUPS_CLOSED_KEY)))
    .limit(1)
  const open = !(row?.value === true || row?.value === 'true')
  cache.set('signupsOpen', open)
  return open
}

/** 403 `data.code: 'hosting_signups_closed'` while the operator has paused sign-ups. */
export async function assertHostingSignupsOpen(db: Db): Promise<void> {
  if (await hostingSignupsOpen(db)) return
  throw httpError({ status: 403, message: 'New sign-ups are paused at the moment. Please check back soon.', data: { code: 'hosting_signups_closed' } })
}

/** 404 unless the switch is on — for routes that only exist on a hosting platform. */
export async function requireHostingPlatform(event: H3Event): Promise<void> {
  if (!(await isHostingPlatform(useDb(event)))) throw notFound()
}
