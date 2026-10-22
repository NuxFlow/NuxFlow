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

/** 404 unless the switch is on — for routes that only exist on a hosting platform. */
export async function requireHostingPlatform(event: H3Event): Promise<void> {
  if (!(await isHostingPlatform(useDb(event)))) throw notFound()
}
