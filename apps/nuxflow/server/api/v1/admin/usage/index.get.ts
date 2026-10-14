import { z } from 'zod'
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { siteUsageDaily, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { parseQuery } from '../../../../utils/validate'
import { USAGE_EVENT_METRICS, USAGE_SNAPSHOT_METRICS, usageDay } from '../../../../utils/usage'

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
})

/**
 * Every site's usage for one calendar month (UTC): event metrics summed over the month,
 * and the latest nightly totals on or before its last day. Event counts lag by up to a
 * minute per isolate (server/utils/usage.ts).
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const { month = usageDay().slice(0, 7) } = parseQuery(event, querySchema)
  const db = useDb(event)

  const first = `${month}-01`
  const nextMonth = new Date(`${first}T00:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  const last = usageDay(new Date(nextMonth.getTime() - 86_400_000))
  // Each site's latest nightly total for a metric, on or before the month's last day.
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
    month,
    from: first,
    to: last,
    sites: siteRows.map(site => ({
      ...site,
      usage: { ...zeros, ...usage.get(site.id) },
      snapshotDay: snapshotDay.get(site.id) ?? null,
    })),
  }
})
