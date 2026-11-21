import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { ANALYTICS_RANGES, type AnalyticsRange } from '../../../utils/analytics'
import { loadSiteAnalytics } from '../../../utils/analytics-report'
import { requireSiteId } from '../../../utils/site-context'
import type { AnalyticsResponse } from '../../../../shared/lib/analytics-types'

const querySchema = z.object({
  days: z.coerce.number().int().refine((d): d is AnalyticsRange => (ANALYTICS_RANGES as readonly number[]).includes(d)).default(30),
})

/** Admin → Analytics: this site's page views, from Analytics Engine (utils/analytics.ts). */
export default defineEventHandler(async (event): Promise<AnalyticsResponse> => {
  await requireRole(event, 'editor')
  const siteId = requireSiteId(event)
  const { days } = await parseQuery(event, querySchema)
  return loadSiteAnalytics(event, siteId, days as AnalyticsRange)
})
