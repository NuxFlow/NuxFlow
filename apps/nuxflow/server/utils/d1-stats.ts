import type { H3Event } from 'h3'
import { getD1 } from './db'
import { createIsolateCache } from './isolate-cache'
import { getCfBindings } from './cf-env'
import { getActiveProviderNameForSite } from './media-providers/index'

// Cloudflare's own stated design philosophy: "D1 is optimized for per-user, per-tenant,
// or per-entity database patterns rather than single large databases." A single D1
// database is capped at 10 GB on paid plans (500 MB on free) with no per-database fee —
// there's no cost penalty to splitting a busy multi-tenant install into multiple
// Worker+D1 "pools" once one approaches that ceiling. This module exists so an operator
// can actually see that coming from inside the product, instead of only finding out via
// `wrangler d1 info` from the CLI or hitting the cap outright.
//
// There is no authoritative on-disk size available from inside a Worker: D1 only
// supports a fixed subset of PRAGMA statements (table_list/table_info/index_list/
// foreign_key_list/etc. — see https://developers.cloudflare.com/d1/sql-api/sql-statements/),
// which notably excludes page_count/page_size (an earlier version of this file tried
// exactly that and 500'd in production — D1 rejects both outright). The real number
// Cloudflare shows in its own dashboard comes from their control plane via the D1 REST
// API, which needs an account-level API token this app doesn't currently ask for or
// store. So `databaseSizeBytes` here is a same-methodology sum of the per-site
// approximations below (content/revision/media column lengths), not a real storage
// measurement — good enough to answer "is it time to plan a second pool", not precise
// enough to budget the exact remaining headroom to the 10 GB cap.
//
// Uses the raw D1 binding (getD1(), like d1-export.ts) rather than Drizzle's query
// builder — this project's integration-test harness was found to return a different row
// shape from Drizzle's db.values()/.raw() than the real D1 adapter does, whereas
// D1Database.prepare().all()'s { results: T[] } contract is Cloudflare's own stable,
// documented one.
export const D1_PAID_PLAN_SIZE_CAP_BYTES = 10 * 1024 * 1024 * 1024

export interface SiteSizeStats {
  siteId: string
  siteName: string
  siteDomain: string
  contentItemCount: number
  contentBytes: number
  revisionCount: number
  revisionBytes: number
  mediaCount: number
  mediaBytes: number
  /** Media-library rows whose file is stored in D1 (the storage fallback), not in real storage. */
  localFallbackMediaCount: number
  /**
   * The provider new uploads go to for this site right now ('local' = no storage
   * connected). Lets the UI tell "nothing connected" apart from "connected, but older
   * files are still in the database and can be moved".
   */
  storageProvider: string
  approxTotalBytes: number
}

export interface D1SizeStats {
  /** Sum of every site's approxTotalBytes — see the module doc for why this isn't an authoritative on-disk measurement. */
  approxDatabaseSizeBytes: number
  sites: SiteSizeStats[]
}

// This runs a full-table SUM(LENGTH(...)) scan across content_items, content_revisions,
// and media with no LIMIT — deliberately, since a partial scan would misreport the
// database's actual size. That's fine for row *counts/bytes* (unlike d1-export.ts's row
// *data* scans, nothing here risks isolate memory), but D1's documented max query
// duration is 30 seconds, and a full scan on a large, mature database — the exact size
// regime this endpoint exists to warn about — risks approaching that on every single
// admin page load/poll. Cached per isolate for 5 minutes using the same pattern as
// settings.ts and theme-cache.ts: this is a monitoring/awareness figure, not a live
// dashboard, so a few minutes of staleness is an acceptable trade for not re-scanning
// the whole database on every request.
const STATS_CACHE_TTL_MS = 5 * 60_000
const STATS_CACHE_KEY = 'global'
const statsCache = createIsolateCache<D1SizeStats>(STATS_CACHE_TTL_MS)

export async function getD1SizeStats(event: H3Event): Promise<D1SizeStats> {
  const cached = statsCache.get(STATS_CACHE_KEY)
  if (cached) return cached

  const stats = await computeD1SizeStats(event)
  statsCache.set(STATS_CACHE_KEY, stats)
  return stats
}

// Labels each query so a failure names which table's scan actually broke, instead of
// an opaque "something in Promise.all failed" — same diagnostic-labeling idea as
// d1-export.ts's own step() helper, for the same reason: this file's own history (see
// the module comment) is entirely undocumented-D1-behavior surprises that were each
// only diagnosable by knowing exactly which query failed.
async function labeledD1Query<T>(label: string, query: Promise<T>): Promise<T> {
  try {
    return await query
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`[d1-stats] ${label} failed: ${message}`, { cause: err })
  }
}

async function computeD1SizeStats(event: H3Event): Promise<D1SizeStats> {
  const d1 = getD1(event)

  const [sitesResult, contentResult, revisionResult, mediaResult] = await Promise.all([
    labeledD1Query('sites lookup', d1.prepare('SELECT id, name, domain FROM sites').all<{ id: string; name: string; domain: string }>()),
    labeledD1Query('content_items size scan', d1.prepare(`
      SELECT site_id as siteId, COUNT(*) as count, COALESCE(SUM(LENGTH(content)), 0) as bytes
      FROM content_items GROUP BY site_id
    `).all<{ siteId: string; count: number; bytes: number }>()),
    // content_revisions has no direct site_id — join through its parent content item.
    labeledD1Query('content_revisions size scan', d1.prepare(`
      SELECT ci.site_id as siteId, COUNT(*) as count, COALESCE(SUM(LENGTH(cr.content)), 0) as bytes
      FROM content_revisions cr JOIN content_items ci ON cr.item_id = ci.id
      GROUP BY ci.site_id
    `).all<{ siteId: string; count: number; bytes: number }>()),
    // LENGTH(url) captures what actually matters here: a provider-hosted media row's
    // url is a short link, while the local base64-data-URI fallback's url IS the file —
    // this single column tells us both the byte cost and (via the local-provider count
    // below) whether a site is relying on that fallback at all.
    labeledD1Query('media size scan', d1.prepare(`
      SELECT site_id as siteId, COUNT(*) as count, COALESCE(SUM(LENGTH(url)), 0) as bytes,
        SUM(CASE WHEN storage_provider = 'local' THEN 1 ELSE 0 END) as localCount
      FROM media GROUP BY site_id
    `).all<{ siteId: string; count: number; bytes: number; localCount: number }>()),
  ])

  const contentBySite = new Map(contentResult.results.map(r => [r.siteId, r]))
  const revisionBySite = new Map(revisionResult.results.map(r => [r.siteId, r]))
  const mediaBySite = new Map(mediaResult.results.map(r => [r.siteId, r]))

  // With the R2 binding present every site has real storage (binding-only R2 needs no
  // per-site settings — see getActiveProvider), so the per-site settings lookups are only
  // needed when it's absent.
  const { r2 } = getCfBindings(event)
  const providerBySite = new Map<string, string>(await Promise.all(
    sitesResult.results.map(async site => [
      site.id,
      r2 ? 'r2' : await getActiveProviderNameForSite(event, site.id).catch(() => 'unknown'),
    ] as [string, string]),
  ))

  const sites: SiteSizeStats[] = sitesResult.results.map((site) => {
    const contentStats = contentBySite.get(site.id) ?? { count: 0, bytes: 0 }
    const revisionStats = revisionBySite.get(site.id) ?? { count: 0, bytes: 0 }
    const mediaStats = mediaBySite.get(site.id) ?? { count: 0, bytes: 0, localCount: 0 }
    return {
      siteId: site.id,
      siteName: site.name,
      siteDomain: site.domain,
      contentItemCount: contentStats.count,
      contentBytes: contentStats.bytes,
      revisionCount: revisionStats.count,
      revisionBytes: revisionStats.bytes,
      mediaCount: mediaStats.count,
      mediaBytes: mediaStats.bytes,
      localFallbackMediaCount: mediaStats.localCount,
      storageProvider: providerBySite.get(site.id) ?? 'unknown',
      approxTotalBytes: contentStats.bytes + revisionStats.bytes + mediaStats.bytes,
    }
  }).sort((a, b) => b.approxTotalBytes - a.approxTotalBytes)

  return {
    approxDatabaseSizeBytes: sites.reduce((sum, s) => sum + s.approxTotalBytes, 0),
    sites,
  }
}
