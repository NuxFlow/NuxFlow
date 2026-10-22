import type { H3Event } from 'h3'
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { siteUsageDaily, sites } from '@nuxflow/db/schema'
import { useDb } from './db'
import { USAGE_EVENT_METRICS, USAGE_SNAPSHOT_METRICS, usageDay } from './usage'
import { POOL_PROTOCOL, assertCompatibleProtocol } from './pool-admin'
import { callPool, poolBindings } from './pools'
import { sitePool } from './pool-sites'

/**
 * Super Admin → Usage's figures (GET /api/v1/admin/usage, /api/v1/admin/usage/:siteId),
 * from this Worker's own sites and — on a hosting platform with member pools — every
 * pool's, which runs the same queries over its own D1 when asked (NuxflowPoolAdmin).
 */

export interface MonthlySiteUsage {
  id: string
  name: string
  domain: string
  status: string
  isPrimary: boolean
  usage: Record<string, number>
  snapshotDay: string | null
  /** The member pool it lives in, or null for this Worker's own sites. */
  poolId: string | null
}

/**
 * Every site's usage for one calendar month (UTC): event metrics summed over the month,
 * and the latest nightly totals on or before its last day. Event counts lag by up to a
 * minute per isolate (server/utils/usage.ts).
 */
export async function localMonthlyUsage(event: H3Event, month: string): Promise<{ from: string; to: string; sites: Omit<MonthlySiteUsage, 'poolId'>[] }> {
  const db = useDb(event)
  const first = `${month}-01`
  const nextMonth = new Date(`${first}T00:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  const last = usageDay(new Date(nextMonth.getTime() - 86_400_000))
  const latestSnapshotDay = sql`(select max(u2.day) from site_usage_daily u2 where u2.site_id = ${siteUsageDaily.siteId} and u2.metric = ${siteUsageDaily.metric} and u2.day <= ${last})`

  const [siteRows, eventRows, snapshotRows] = await Promise.all([
    db.select({ id: sites.id, name: sites.name, domain: sites.domain, status: sites.status, isPrimary: sites.isPrimary }).from(sites),
    db.select({ siteId: siteUsageDaily.siteId, metric: siteUsageDaily.metric, value: sql<number>`sum(${siteUsageDaily.value})` })
      .from(siteUsageDaily)
      .where(and(inArray(siteUsageDaily.metric, [...USAGE_EVENT_METRICS]), gte(siteUsageDaily.day, first), lte(siteUsageDaily.day, last)))
      .groupBy(siteUsageDaily.siteId, siteUsageDaily.metric),
    db.select({ siteId: siteUsageDaily.siteId, metric: siteUsageDaily.metric, day: siteUsageDaily.day, value: siteUsageDaily.value })
      .from(siteUsageDaily)
      .where(and(inArray(siteUsageDaily.metric, [...USAGE_SNAPSHOT_METRICS]), eq(siteUsageDaily.day, latestSnapshotDay))),
  ])

  const usage = new Map<string, Record<string, number>>()
  const snapshotDay = new Map<string, string>()
  for (const r of eventRows) {
    const row = usage.get(r.siteId) ?? {}
    row[r.metric] = Number(r.value)
    usage.set(r.siteId, row)
  }
  for (const r of snapshotRows) {
    const row = usage.get(r.siteId) ?? {}
    row[r.metric] = r.value
    usage.set(r.siteId, row)
    if ((snapshotDay.get(r.siteId) ?? '') < r.day) snapshotDay.set(r.siteId, r.day)
  }

  const zeros = Object.fromEntries([...USAGE_EVENT_METRICS, ...USAGE_SNAPSHOT_METRICS].map(m => [m, 0]))
  return {
    from: first,
    to: last,
    sites: siteRows.map(site => ({
      ...site,
      usage: { ...zeros, ...usage.get(site.id) },
      snapshotDay: snapshotDay.get(site.id) ?? null,
    })),
  }
}

/** The month for every site: this Worker's, then each reachable pool's (unreachable pools named). */
export async function monthlyUsageEverywhere(event: H3Event, month: string) {
  const own = await localMonthlyUsage(event, month)
  const unreachablePools: string[] = []
  const pooled = await Promise.all(poolBindings(event).map(async ({ binding, stub }) => {
    try {
      const [status, report] = await Promise.all([
        callPool(stub.status(), binding),
        callPool(stub.monthlyUsage({ protocol: POOL_PROTOCOL, month }), binding),
      ])
      // A pool has no primary site; its sites are customers'.
      return report.sites.map(s => ({ ...s, isPrimary: false, poolId: status.poolId }))
    } catch (err) {
      console.error(`[usage] Couldn't get ${binding}'s usage:`, err)
      unreachablePools.push(binding)
      return []
    }
  }))
  return {
    from: own.from,
    to: own.to,
    sites: [...own.sites.map(s => ({ ...s, poolId: null })), ...pooled.flat()] as MonthlySiteUsage[],
    unreachablePools,
  }
}

/**
 * One site's usage per day over the last `days` days (UTC), oldest first. A day with no
 * events is 0; a day with no nightly snapshot is null (not measured, rather than empty).
 * Null when the site isn't in this database.
 */
export async function localSiteUsageSeries(event: H3Event, siteId: string, days: number) {
  const db = useDb(event)
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { id: true, name: true, domain: true } })
  if (!site) return null

  const now = Date.now()
  const dayList = Array.from({ length: days }, (_, i) => usageDay(new Date(now - (days - 1 - i) * 86_400_000)))
  const rows = await db.select({ day: siteUsageDaily.day, metric: siteUsageDaily.metric, value: siteUsageDaily.value })
    .from(siteUsageDaily)
    .where(and(eq(siteUsageDaily.siteId, siteId), gte(siteUsageDaily.day, dayList[0]!)))
    .orderBy(asc(siteUsageDaily.day))

  const index = new Map(dayList.map((d, i) => [d, i]))
  const series: Record<string, (number | null)[]> = Object.fromEntries([
    ...USAGE_EVENT_METRICS.map(m => [m, Array.from({ length: days }, () => 0)]),
    ...USAGE_SNAPSHOT_METRICS.map(m => [m, Array.from({ length: days }, () => null)]),
  ])
  for (const r of rows) {
    const i = index.get(r.day)
    if (i !== undefined && series[r.metric]) series[r.metric]![i] = r.value
  }
  return { site, days: dayList, series }
}

export type SiteUsageSeries = NonNullable<Awaited<ReturnType<typeof localSiteUsageSeries>>>

/** One site's series wherever it lives. Null when no such site. */
export async function siteUsageSeriesEverywhere(event: H3Event, siteId: string, days: number): Promise<SiteUsageSeries | null> {
  const own = await localSiteUsageSeries(event, siteId, days)
  if (own) return own
  const pool = await sitePool(event, siteId)
  if (!pool) return null
  return callPool(pool.stub.siteUsage({ protocol: POOL_PROTOCOL, siteId, days }), `pool ${pool.poolId}`)
}

// ── Answers a member pool gives its control plane (NuxflowPoolAdmin) ─────────────────

export async function poolMonthlyUsage(event: H3Event, input: { protocol: number; month: string }) {
  assertCompatibleProtocol(input.protocol)
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.month)) throw new Error('Not a month: ' + input.month)
  return localMonthlyUsage(event, input.month)
}

export async function poolSiteUsage(event: H3Event, input: { protocol: number; siteId: string; days: number }) {
  assertCompatibleProtocol(input.protocol)
  return localSiteUsageSeries(event, input.siteId, Math.min(400, Math.max(7, Math.floor(input.days))))
}
