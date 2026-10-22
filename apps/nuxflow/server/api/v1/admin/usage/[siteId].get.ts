import { z } from 'zod'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { parseQuery } from '../../../../utils/validate'
import { notFound } from '../../../../utils/response'
import { siteUsageSeriesEverywhere } from '../../../../utils/usage-report'

const querySchema = z.object({
  days: z.coerce.number().int().min(7).max(400).default(30),
})

/**
 * One site's usage per day over the last `days` days (UTC), oldest first — wherever the
 * site lives (utils/usage-report.ts).
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  await requireHostingPlatform(event)
  const siteId = getRouterParam(event, 'siteId')!
  const { days } = parseQuery(event, querySchema)
  const series = await siteUsageSeriesEverywhere(event, siteId, days)
  if (!series) throw notFound('Site not found')
  return series
})
