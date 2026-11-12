// Admin → Analytics: what GET /api/v1/analytics sends (server/utils/analytics.ts builds the
// report). Import-free.

export const ANALYTICS_RANGES = [7, 30, 90] as const
export type AnalyticsRange = typeof ANALYTICS_RANGES[number]

export interface SiteAnalytics {
  days: AnalyticsRange
  views: number
  /** Views in the period before this one; null when that's past Cloudflare's 3-month retention. */
  previousViews: number | null
  series: { day: string; views: number }[]
  pages: { path: string; views: number }[]
  referrers: { host: string; views: number }[]
  countries: { code: string; views: number }[]
  devices: { device: string; views: number }[]
}

export interface AnalyticsResponse {
  /** The `AE` binding is in wrangler.toml, so views are being recorded. */
  recording: boolean
  /** The operator has saved an API token and account ID, so they can be read back. */
  readable: boolean
  report: SiteAnalytics | null
  error: string | null
}
