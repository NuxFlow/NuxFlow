import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { getAnalyticsEngine } from '../../../utils/cf-env'
import { useDb } from '../../../utils/db'
import { getPlatformSetting } from '../../../utils/control-plane'
import { ANALYTICS_RANGES, ANALYTICS_TOKEN_KEY, AnalyticsQueryError, querySiteAnalytics, type AnalyticsRange, type SiteAnalytics } from '../../../utils/analytics'
import { requireSiteId } from '../../../utils/site-context'

const querySchema = z.object({
  days: z.coerce.number().int().refine((d): d is AnalyticsRange => (ANALYTICS_RANGES as readonly number[]).includes(d)).default(30),
})

export interface AnalyticsResponse {
  /** The `AE` binding is in wrangler.toml, so views are being recorded. */
  recording: boolean
  /** The operator has saved an API token and account ID, so they can be read back. */
  readable: boolean
  report: SiteAnalytics | null
  error: string | null
}

/** Admin → Analytics: this site's page views, from Analytics Engine (utils/analytics.ts). */
export default defineEventHandler(async (event): Promise<AnalyticsResponse> => {
  await requireRole(event, 'editor')
  const siteId = requireSiteId(event)
  const { days } = await parseQuery(event, querySchema)

  // The dataset is the operator's, so are the credentials to read it: platform settings
  // (Super Admin → Platform, sent on to member pools) used for every site's report.
  const db = useDb(event)
  const [token, accountId] = await Promise.all([
    getPlatformSetting(db, ANALYTICS_TOKEN_KEY),
    getPlatformSetting(db, 'cloudflare.account_id'),
  ])

  const recording = getAnalyticsEngine(event) !== null
  const readable = !!token && !!accountId && /^[a-f0-9]{32}$/i.test(accountId)
  if (!readable) return { recording, readable, report: null, error: null }

  try {
    const report = await querySiteAnalytics({ accountId: accountId!, token: token!, dataset: useRuntimeConfig().analyticsDataset }, siteId, days as AnalyticsRange)
    return { recording, readable, report, error: null }
  } catch (err) {
    if (!(err instanceof AnalyticsQueryError)) console.error('[analytics] Query failed', err)
    return { recording, readable, report: null, error: err instanceof AnalyticsQueryError ? err.message : 'Could not load analytics from Cloudflare.' }
  }
})
