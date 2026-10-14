import { z } from 'zod'
import { and, asc, eq, gte } from 'drizzle-orm'
import { siteUsageDaily, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { parseQuery } from '../../../../utils/validate'
import { notFound } from '../../../../utils/response'
import { USAGE_EVENT_METRICS, USAGE_SNAPSHOT_METRICS, usageDay } from '../../../../utils/usage'

const querySchema = z.object({
  days: z.coerce.number().int().min(7).max(400).default(30),
})

/**
 * One site's usage per day over the last `days` days (UTC), oldest first. A day with no
 * events is 0; a day with no nightly snapshot is null (not measured, rather than empty).
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const siteId = getRouterParam(event, 'siteId')!
  const { days } = parseQuery(event, querySchema)
  const db = useDb(event)

  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { id: true, name: true, domain: true } })
  if (!site) throw notFound('Site not found')

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
})
