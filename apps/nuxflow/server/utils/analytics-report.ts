import type { H3Event } from 'h3'
import { useDb } from './db'
import { getAnalyticsEngine } from './cf-env'
import { getPlatformSetting } from './control-plane'
import { ANALYTICS_TOKEN_KEY, AnalyticsQueryError, querySiteAnalytics, type AnalyticsRange } from './analytics'
import type { AnalyticsResponse } from '../../shared/lib/analytics-types'

/**
 * A site's page-view report as Admin → Analytics shows it (GET /api/v1/analytics and the
 * MCP `get_analytics` tool). The dataset and the credentials to read it are the operator's:
 * platform settings (Super Admin → Platform, sent on to member pools) used for every site.
 */
export async function loadSiteAnalytics(event: H3Event, siteId: string, days: AnalyticsRange): Promise<AnalyticsResponse> {
  const db = useDb(event)
  const [token, accountId] = await Promise.all([
    getPlatformSetting(db, ANALYTICS_TOKEN_KEY),
    getPlatformSetting(db, 'cloudflare.account_id'),
  ])

  const recording = getAnalyticsEngine(event) !== null
  const readable = !!token && !!accountId && /^[a-f0-9]{32}$/i.test(accountId)
  if (!readable) return { recording, readable, report: null, error: null }

  try {
    const report = await querySiteAnalytics({ accountId: accountId!, token: token!, dataset: useRuntimeConfig().analyticsDataset }, siteId, days)
    return { recording, readable, report, error: null }
  } catch (err) {
    if (!(err instanceof AnalyticsQueryError)) console.error('[analytics] Query failed', err)
    return { recording, readable, report: null, error: err instanceof AnalyticsQueryError ? err.message : 'Could not load analytics from Cloudflare.' }
  }
}
