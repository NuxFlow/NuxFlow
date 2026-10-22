import { asc, count, desc, eq, sql } from 'drizzle-orm'
import { platformSettings, siteDomains, sites } from '@nuxflow/db/schema'
import type { Db } from './db'
import { getPoolId, isMemberPool, POOL_PLATFORM_SETTINGS, storePlatformSettings } from './control-plane'
import { clearAiDailyCapCache } from './ai-allowance'
import { clearAnalyticsCache } from './analytics'

/**
 * What a member pool answers when its control plane asks — over the private
 * `NuxflowPoolAdmin` RPC entrypoint (server/pool-host/entrypoint.ts), reached only through
 * the control plane's service binding, never from the internet.
 *
 * The control plane and a pool often run different releases for days (release rings), so
 * every call carries POOL_PROTOCOL and each side accepts the other one version ahead or
 * behind. Changing a shape: add fields as optional and bump the protocol; only rely on
 * them once every pool runs the new release.
 */
export const POOL_PROTOCOL = 1

export class PoolProtocolError extends Error {}

export function assertCompatibleProtocol(theirs: unknown): void {
  if (typeof theirs !== 'number' || Math.abs(theirs - POOL_PROTOCOL) > 1) {
    throw new PoolProtocolError(`Incompatible pool protocol ${String(theirs)} (this side speaks ${POOL_PROTOCOL}). Deploy the same release to both.`)
  }
}

export interface PoolStatus {
  protocol: number
  poolId: string | null
  commit: string | null
  release: string | null
  siteCount: number
  /** Newest migration file applied to this pool's D1. */
  lastMigration: string | null
  /** When the control plane last sent platform settings (null = never). */
  settingsReceivedAt: string | null
}

export interface PoolSite {
  id: string
  name: string
  domain: string
  status: string
  createdAt: string
  /**
   * The site's extra addresses (site_domains), which redirect to `domain`. Optional:
   * a pool on an older release doesn't send it.
   */
  aliases?: string[]
  /** Optional, like aliases: older pools don't send them. */
  hostingPlanId?: string | null
  locale?: string
}

export async function poolStatus(db: Db): Promise<PoolStatus> {
  const config = useRuntimeConfig()
  const [[siteRow], [settingsRow], lastMigration] = await Promise.all([
    db.select({ n: count() }).from(sites),
    db.select({ at: platformSettings.updatedAt }).from(platformSettings).where(eq(platformSettings.key, RECEIVED_AT_KEY)),
    newestMigration(db),
  ])
  return {
    protocol: POOL_PROTOCOL,
    poolId: getPoolId(),
    commit: config.buildCommit ? String(config.buildCommit) : null,
    release: config.buildRelease ? String(config.buildRelease) : null,
    siteCount: siteRow?.n ?? 0,
    lastMigration,
    settingsReceivedAt: settingsRow?.at ?? null,
  }
}

async function newestMigration(db: Db): Promise<string | null> {
  try {
    const rows = await db.all<{ filename: string }>(sql`SELECT filename FROM _nuxflow_migrations ORDER BY filename DESC LIMIT 1`)
    return rows[0]?.filename ?? null
  } catch {
    return null // not migrated yet
  }
}

export async function poolSites(db: Db): Promise<PoolSite[]> {
  const [rows, extra] = await Promise.all([
    db.select({ id: sites.id, name: sites.name, domain: sites.domain, status: sites.status, createdAt: sites.createdAt, hostingPlanId: sites.hostingPlanId, locale: sites.locale })
      .from(sites)
      .orderBy(desc(sites.isPrimary), asc(sites.createdAt)),
    db.select({ siteId: siteDomains.siteId, hostname: siteDomains.hostname }).from(siteDomains),
  ])
  return rows.map(site => ({ ...site, locale: site.locale ?? undefined, aliases: extra.filter(d => d.siteId === site.id).map(d => d.hostname) }))
}

const RECEIVED_AT_KEY = '_received_at'

export interface PushedSettings {
  protocol: number
  /** Every platform setting (null = unset), so one that was removed is removed here too. */
  settings: Record<string, string | null>
}

/** Stores the platform settings the control plane sent. Only a member pool accepts them. */
export async function receivePlatformSettings(db: Db, payload: PushedSettings): Promise<{ stored: number }> {
  if (!isMemberPool()) throw new Error('Only a member pool takes platform settings from a control plane.')
  assertCompatibleProtocol(payload?.protocol)
  const settings = payload.settings ?? {}
  // Keys a newer control plane knows but this pool doesn't are skipped, not refused.
  const known = Object.fromEntries(Object.entries(settings).filter(([key]) => Object.hasOwn(POOL_PLATFORM_SETTINGS, key)))
  await storePlatformSettings(db, known)
  // When settings last arrived, even if all of them were empty. Not a platform setting:
  // getPlatformSetting() can't read it.
  await db.insert(platformSettings).values({ key: RECEIVED_AT_KEY, value: null })
    .onConflictDoUpdate({ target: platformSettings.key, set: { updatedAt: sql`(datetime('now'))` } })
  clearAiDailyCapCache()
  clearAnalyticsCache()
  return { stored: Object.values(known).filter(v => v !== null && v !== '').length }
}
