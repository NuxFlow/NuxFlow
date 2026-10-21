import type { H3Event } from 'h3'
import { getAnalyticsEngine } from './cf-env'
import { isPageCachePath } from './page-cache'
import { detectCrawler, isNoindexPath } from './seo'
import { createIsolateCache } from './isolate-cache'

/**
 * Visitor analytics (Admin → Analytics), on Cloudflare Analytics Engine.
 *
 * Recording: the browser sends one beacon per public page view (app/plugins/
 * page-views.client.ts → POST /_nuxflow/view → recordPageView()). It is done from the
 * browser rather than on the server because the server can't see most views: a cached
 * page never reaches SSR or the page API, and moving between pages inside the app
 * doesn't request an HTML page at all. A beacon also only fires for a page that
 * actually rendered, so broken links and most bots (which don't run JavaScript) aren't
 * counted. Nothing is stored on the visitor's device and no identifier is recorded —
 * each data point is a page, a country, the referring *host*, and a device class.
 *
 * One data point per view in the `AE` dataset, indexed by site id:
 *   blobs: ['view', path, country, referrerHost, device]   doubles: [1]
 * The leading 'view' tells these apart from crawler-tracking.ts's 'crawler' points,
 * which share the dataset.
 *
 * Reading: the Analytics Engine SQL API, with an account-level API token the platform
 * operator saves in Super Admin → Platform (stored on the primary site, since the
 * dataset belongs to the operator's Cloudflare account and serves every site).
 */

export const ANALYTICS_TOKEN_KEY = 'analytics.cf_api_token'
export const ANALYTICS_RANGES = [7, 30, 90] as const
export type AnalyticsRange = typeof ANALYTICS_RANGES[number]

// ─── Recording ────────────────────────────────────────────────────────────────

// Known search/AI crawlers are caught by detectCrawler(); this catches the rest of the
// automated traffic that does run JavaScript (headless browsers, monitors, previewers).
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|phantom|puppeteer|playwright|selenium|curl|wget|python|httpclient|okhttp|go-http|node-fetch|axios|java\//i

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true
  return detectCrawler(userAgent) !== null || BOT_UA.test(userAgent)
}

export function deviceClass(userAgent: string | null | undefined): 'mobile' | 'tablet' | 'desktop' {
  const ua = userAgent ?? ''
  if (/ipad|tablet|kindle|silk|playbook|android(?!.*mobile)/i.test(ua)) return 'tablet'
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

/**
 * Just the host of an external referrer — a full URL can carry search terms, tokens or
 * other personal data. '' for none, for the site's own pages, or for anything unparsable.
 */
export function referrerHost(referrer: string | null | undefined, ownHost: string | null | undefined): string {
  if (!referrer) return ''
  let host: string
  try {
    const url = new URL(referrer)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    host = url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
  const own = (ownHost ?? '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '')
  return host === own ? '' : host.slice(0, 128)
}

const FILE_PATH = /\.[a-z0-9]{1,8}$/i

/** The path as it's counted, or null when it isn't a public page. */
export function normalizeViewPath(raw: string): string | null {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  let path = raw.split(/[?#]/, 1)[0]!
  if (path.length > 1) path = path.replace(/\/+$/, '')
  if (!path || path.length > 256) return null
  if (!isPageCachePath(path) || isNoindexPath(path) || FILE_PATH.test(path)) return null
  return path
}

export function recordPageView(event: H3Event, siteId: string, view: { path: string; referrer?: string }): boolean {
  const ae = getAnalyticsEngine(event)
  if (!ae) return false
  const userAgent = getRequestHeader(event, 'user-agent')
  if (isLikelyBot(userAgent)) return false
  const path = normalizeViewPath(view.path)
  if (!path) return false

  try {
    ae.writeDataPoint({
      blobs: [
        'view',
        path,
        (getRequestHeader(event, 'cf-ipcountry') ?? 'XX').toUpperCase().slice(0, 2),
        referrerHost(view.referrer, getRequestHeader(event, 'host')),
        deviceClass(userAgent),
      ],
      doubles: [1],
      indexes: [siteId],
    })
    return true
  } catch (err) {
    console.error('[analytics] Analytics Engine write failed', err)
    return false
  }
}

// ─── Reading ──────────────────────────────────────────────────────────────────

export interface AnalyticsQueryConfig {
  accountId: string
  token: string
  dataset: string
}

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

const SAFE_ID = /^[\w-]{1,64}$/
const SAFE_DATASET = /^\w{1,64}$/

/**
 * The SQL for one site's report. The SQL API takes no bound parameters, so everything
 * inlined is checked against a strict pattern first — the site id comes from our own
 * database, but this is the one place a stray quote would turn into a cross-site read.
 * Counts are SUM(_sample_interval): Analytics Engine samples busy datasets, and each
 * stored row stands for that many original data points.
 */
export function analyticsSql(dataset: string, siteId: string, days: AnalyticsRange) {
  if (!SAFE_DATASET.test(dataset)) throw new Error('Invalid Analytics Engine dataset name')
  if (!SAFE_ID.test(siteId)) throw new Error('Invalid site id')
  if (!ANALYTICS_RANGES.includes(days)) throw new Error('Invalid range')

  // Whole UTC days: today plus the days-1 before it, so the chart's bars and the total agree.
  const start = `toStartOfInterval(NOW(), INTERVAL '1' DAY) - INTERVAL '${days - 1}' DAY`
  const base = `FROM ${dataset} WHERE index1 = '${siteId}' AND blob1 = 'view'`
  const current = `${base} AND timestamp >= ${start}`
  const top = (blob: string, limit: number) =>
    `SELECT ${blob} AS key, SUM(_sample_interval) AS views ${current} GROUP BY key ORDER BY views DESC LIMIT ${limit}`

  return {
    total: `SELECT SUM(_sample_interval) AS views ${current}`,
    // The previous period of the same length, while it's still within the 90-day retention.
    previous: days * 2 <= 90
      ? `SELECT SUM(_sample_interval) AS views ${base} AND timestamp >= ${start} - INTERVAL '${days}' DAY AND timestamp < ${start}`
      : null,
    series: `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, SUM(_sample_interval) AS views ${current} GROUP BY day ORDER BY day`,
    pages: top('blob2', 10),
    countries: top('blob3', 10),
    referrers: top('blob4', 10),
    devices: top('blob5', 3),
  }
}

export class AnalyticsQueryError extends Error {}

async function runSql(cfg: AnalyticsQueryConfig, sql: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}` },
    body: sql,
  })
  const text = await res.text()
  if (!res.ok) {
    // Analytics Engine creates a dataset on its first write, so a site that hasn't had
    // a visitor since analytics was switched on has nothing to query yet.
    if (/unknown table|does not exist|table .* not found/i.test(text)) return []
    if (res.status === 401 || res.status === 403) {
      throw new AnalyticsQueryError('Cloudflare refused the analytics API token. It needs the permission Account → Account Analytics → Read, for the account the Worker runs in.')
    }
    throw new AnalyticsQueryError(`Cloudflare's analytics API returned ${res.status}: ${text.slice(0, 300)}`)
  }
  try {
    const json = JSON.parse(text) as { data?: Record<string, unknown>[] }
    return json.data ?? []
  } catch {
    throw new AnalyticsQueryError('Cloudflare\'s analytics API sent a response NuxFlow couldn\'t read.')
  }
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** The UTC days the report covers, oldest first, as YYYY-MM-DD. */
export function reportDays(days: AnalyticsRange, now = new Date()): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10))
}

// Five minutes per site and range: the dashboard is opened far more often than the
// numbers meaningfully change, and every query counts against the account's allowance.
const reportCache = createIsolateCache<SiteAnalytics>(5 * 60_000)

export function clearAnalyticsCache(): void {
  reportCache.clear()
}

export async function querySiteAnalytics(cfg: AnalyticsQueryConfig, siteId: string, days: AnalyticsRange, now = new Date()): Promise<SiteAnalytics> {
  const cacheKey = `${siteId}:${days}`
  const cached = reportCache.get(cacheKey)
  if (cached) return cached

  const sql = analyticsSql(cfg.dataset, siteId, days)
  const [total, previous, series, pages, countries, referrers, devices] = await Promise.all([
    runSql(cfg, sql.total),
    sql.previous ? runSql(cfg, sql.previous) : Promise.resolve(null),
    runSql(cfg, sql.series),
    runSql(cfg, sql.pages),
    runSql(cfg, sql.countries),
    runSql(cfg, sql.referrers),
    runSql(cfg, sql.devices),
  ])

  const byDay = new Map(series.map(r => [String(r.day).slice(0, 10), num(r.views)]))
  const rows = (list: Record<string, unknown>[]) => list.map(r => ({ key: String(r.key ?? ''), views: num(r.views) })).filter(r => r.views > 0)

  const report: SiteAnalytics = {
    days,
    views: num(total[0]?.views),
    previousViews: previous ? num(previous[0]?.views) : null,
    series: reportDays(days, now).map(day => ({ day, views: byDay.get(day) ?? 0 })),
    pages: rows(pages).map(r => ({ path: r.key, views: r.views })),
    countries: rows(countries).map(r => ({ code: r.key, views: r.views })),
    referrers: rows(referrers).map(r => ({ host: r.key, views: r.views })),
    devices: rows(devices).map(r => ({ device: r.key, views: r.views })),
  }
  reportCache.set(cacheKey, report)
  return report
}
