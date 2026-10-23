import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { siteUsageDaily, sites, videoAssets } from '@nuxflow/db/schema'
import type { Db } from './db'
import { isHostingPlatform } from './hosting-platform'
import { getPlatformSetting } from './control-plane'
import { checkPlanLimit, planLimitMessage } from './hosting-plans'
import { noticePlanLimitOnce } from './plan-limit-notice'
import { setStreamVideoPrivate, type StreamAccount } from './stream'
import { bumpCacheVersion } from './cache-version'
import { utcDay } from './utc-day'
import { errorMessage } from './errors'

/**
 * The hosting plan's "Video minutes watched a month" (`video_watch`): only video in the
 * platform's Stream account counts (`video_assets.stream_account = 'platform'`).
 *
 * **Counting.** Stream is watched straight from Cloudflare — no NuxFlow request sees it —
 * so the minutes come from Stream's analytics (GraphQL `streamMinutesViewedAdaptiveGroups`,
 * per video uid) with the operator's analytics API token (`analytics.cf_api_token`, Account
 * Analytics Read). Each run asks for yesterday and today and writes each day's total per
 * site to `site_usage_daily` (`video_minutes_viewed`), replacing what was there, so a rerun
 * never double-counts. Analytics lag a few minutes and this runs hourly: a site can go
 * a little over before it's paused.
 *
 * **Enforcing.** A site at or over its allowance has its platform videos paused
 * (`watch_paused`, Stream `requireSignedURLs`) and its admins told once that month; no
 * signed link is given out for a paused video (video-playback.get.ts). When the allowance
 * resets on the 1st, or the plan grows, the next run plays them again.
 */

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'
const PAGE_SIZE = 10_000
const MAX_PAGES = 20

const MINUTES_QUERY = `query VideoMinutes($accountTag: string!, $start: Date!, $end: Date!, $after: string!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      streamMinutesViewedAdaptiveGroups(filter: { date_geq: $start, date_lt: $end, uid_gt: $after }, orderBy: [uid_ASC], limit: ${PAGE_SIZE}) {
        sum { minutesViewed }
        dimensions { uid }
      }
    }
  }
}`

interface MinutesResponse {
  data?: { viewer?: { accounts?: Array<{ streamMinutesViewedAdaptiveGroups?: Array<{ sum?: { minutesViewed?: number }; dimensions?: { uid?: string } }> }> } }
  errors?: Array<{ message: string }> | null
}

/** Minutes watched per video uid on one UTC day (`YYYY-MM-DD`), across the whole account. */
export async function fetchMinutesViewed(accountId: string, token: string, day: string, fetcher: typeof fetch = fetch): Promise<Map<string, number>> {
  const end = utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000))
  const minutes = new Map<string, number>()
  let after = ''
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetcher(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: MINUTES_QUERY, variables: { accountTag: accountId, start: day, end, after } }),
      signal: AbortSignal.timeout(20_000),
    })
    const data = await res.json().catch(() => null) as MinutesResponse | null
    if (!res.ok || !data || data.errors?.length) {
      throw new Error(`Stream analytics refused the query (HTTP ${res.status}): ${data?.errors?.map(e => e.message).join('; ') || 'no details'}`)
    }
    const rows = data.data?.viewer?.accounts?.[0]?.streamMinutesViewedAdaptiveGroups ?? []
    for (const row of rows) {
      const uid = row.dimensions?.uid
      if (uid) minutes.set(uid, (minutes.get(uid) ?? 0) + (row.sum?.minutesViewed ?? 0))
    }
    if (rows.length < PAGE_SIZE) break
    after = rows.at(-1)?.dimensions?.uid ?? ''
    if (!after) break
  }
  return minutes
}

export interface VideoWatchResult {
  counted: boolean
  sites: number
  paused: number
  resumed: number
}

/**
 * Hourly: counts minutes watched and pauses or resumes each site's platform videos.
 * `eventFor` builds a request-less event for a site (createSystemEvent), for the notices
 * and cache clears.
 */
export async function syncVideoWatchUsage(db: Db, eventFor: (siteId: string, host: string) => H3Event, now = new Date(), fetcher: typeof fetch = fetch): Promise<VideoWatchResult> {
  const result: VideoWatchResult = { counted: false, sites: 0, paused: 0, resumed: 0 }
  if (!(await isHostingPlatform(db))) return result

  // Every site's videos in the platform account — this job looks after all of them.
  const rows = await db.select({
    id: videoAssets.id,
    siteId: videoAssets.siteId,
    uid: videoAssets.cloudflareStreamId,
    isPrivate: videoAssets.isPrivate,
    watchPaused: videoAssets.watchPaused,
  }).from(videoAssets).where(eq(videoAssets.streamAccount, 'platform'))
  if (!rows.length) return result

  const [accountId, streamToken, analyticsToken] = await Promise.all([
    getPlatformSetting(db, 'cloudflare.account_id'),
    getPlatformSetting(db, 'cloudflare.stream_token'),
    getPlatformSetting(db, 'analytics.cf_api_token'),
  ])

  // 1. Count.
  if (accountId && analyticsToken) {
    const siteOf = new Map(rows.map(r => [r.uid, r.siteId]))
    const today = utcDay(now)
    const yesterday = utcDay(new Date(now.getTime() - 86_400_000))
    try {
      for (const day of [yesterday, today]) {
        const perVideo = await fetchMinutesViewed(accountId, analyticsToken, day, fetcher)
        const perSite = new Map<string, number>()
        for (const [uid, minutes] of perVideo) {
          const siteId = siteOf.get(uid)
          if (siteId) perSite.set(siteId, (perSite.get(siteId) ?? 0) + minutes)
        }
        for (const [siteId, minutes] of perSite) {
          const value = Math.ceil(minutes)
          await db.insert(siteUsageDaily).values({ siteId, day, metric: 'video_minutes_viewed', value })
            .onConflictDoUpdate({ target: [siteUsageDaily.siteId, siteUsageDaily.day, siteUsageDaily.metric], set: { value } })
        }
      }
      result.counted = true
    } catch (err) {
      // Enforcement below still runs on what was counted before.
      console.error('[video-usage] Counting minutes watched failed:', errorMessage(err, String(err)))
    }
  } else {
    console.warn('[video-usage] No Cloudflare account id or analytics API token on Super Admin → Platform: minutes watched can\'t be counted, so "Video minutes watched a month" isn\'t enforced.')
  }

  // 2. Pause or resume.
  const account: StreamAccount | null = accountId && streamToken ? { kind: 'platform', accountId, token: streamToken } : null
  if (!account) return result
  const bySite = new Map<string, typeof rows>()
  for (const r of rows) bySite.set(r.siteId, [...(bySite.get(r.siteId) ?? []), r])
  const hosts = new Map((await db.select({ id: sites.id, domain: sites.domain }).from(sites)
    .where(inArray(sites.id, [...bySite.keys()]))).map(s => [s.id, s.domain]))

  for (const [siteId, videos] of bySite) {
    result.sites++
    const check = await checkPlanLimit(db, siteId, 'video_watch', 0)
    const over = check.max !== null && check.used >= check.max
    const toChange = videos.filter(v => v.watchPaused !== over)
    if (!toChange.length) continue

    let changed = 0
    for (const v of toChange) {
      try {
        // A private video already needs signed links; only its flag changes.
        if (!v.isPrivate) await setStreamVideoPrivate(account, v.uid, over)
        await db.update(videoAssets).set({ watchPaused: over }).where(and(eq(videoAssets.id, v.id), eq(videoAssets.siteId, siteId)))
        changed++
      } catch (err) {
        console.error(`[video-usage] Couldn't ${over ? 'pause' : 'resume'} video ${v.uid}:`, errorMessage(err, String(err)))
      }
    }
    if (!changed) continue
    if (over) result.paused += changed
    else result.resumed += changed

    const event = eventFor(siteId, hosts.get(siteId) ?? 'localhost')
    // Pages are cached with each video's playability (markPrivateVideos).
    await bumpCacheVersion(event, siteId).catch(() => {})
    if (over) {
      await noticePlanLimitOnce(event, siteId, 'video_watch', 'Videos paused for the rest of the month', planLimitMessage('video_watch', check.max ?? 0))
    }
  }
  return result
}
