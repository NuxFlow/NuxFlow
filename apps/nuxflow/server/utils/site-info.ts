import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import { useDb } from './db'
import { createIsolateCache } from './isolate-cache'

export interface SiteInfo {
  id: string
  name: string
  domain: string
  status: string
  isPrimary: boolean
}

// Keyed by site id. Cleared together with the host → site cache (clearSiteCache in
// 02.multi-site.ts) whenever a site is created, edited or deleted; the TTL only has to
// cover other isolates.
const cache = createIsolateCache<SiteInfo | null>(30_000)

export function clearSiteInfoCache(): void {
  cache.clear()
}

/** A site's identity by id — for code that has a siteId but not its domain/name. */
export async function getSiteInfo(event: H3Event, siteId: string): Promise<SiteInfo | null> {
  const cached = cache.get(siteId)
  if (cached !== undefined) return cached
  const row = await useDb(event).query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true, name: true, domain: true, status: true, isPrimary: true },
  })
  const info = row ?? null
  cache.set(siteId, info)
  return info
}

/** True for the platform operator's own site (see sites.is_primary). */
export async function isPrimarySite(event: H3Event, siteId: string | null | undefined): Promise<boolean> {
  if (!siteId) return false
  return (await getSiteInfo(event, siteId))?.isPrimary ?? false
}

/** The operator's own site, if one is marked primary. */
export async function getPrimarySite(event: H3Event): Promise<SiteInfo | null> {
  const row = await useDb(event).query.sites.findFirst({
    where: eq(sites.isPrimary, true),
    columns: { id: true, name: true, domain: true, status: true, isPrimary: true },
  })
  return row ?? null
}

/**
 * A prototype-linked copy of `event` with only `context.siteId` swapped — for code acting
 * on a site other than the one the request arrived on (super admin site deletion, the
 * Database page, account deletion cancelling each site's subscriptions), where
 * resolveSetting() must read *that* site's settings.
 */
export function eventForSite(event: H3Event, siteId: string): H3Event {
  return Object.create(event, {
    context: { value: { ...event.context, siteId }, enumerable: true },
  }) as H3Event
}
