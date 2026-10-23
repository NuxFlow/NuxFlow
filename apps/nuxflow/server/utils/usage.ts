import type { H3Event } from 'h3'
import { siteUsageDaily } from '@nuxflow/db/schema'
import { sql } from 'drizzle-orm'
import { useDb, type Db } from './db'
import { waitUntil } from './cf-env'
import { utcDay } from './utc-day'
import { createCounterBuffer } from './counter-buffer'

/**
 * Per-site usage counting (site_usage_daily) — what each site uses, for Super Admin →
 * Usage and, later, hosting-plan limits.
 *
 * Event metrics are counted as they happen with `countUsage()`. Nothing is written per
 * request: counts are added up in this isolate and written in one statement at most once
 * per FLUSH_INTERVAL_MS (the first count in a fresh isolate is written straight away, so a
 * quiet site still shows up) — the same method crawler-tracking.ts uses. Counts still
 * waiting when an isolate shuts down are lost; the numbers are approximate on the low side,
 * never inflated. Every write is backgrounded, and a failure is logged, never surfaced.
 *
 * Snapshot metrics are totals rather than events, written once a night by
 * server/scheduled/usage-snapshot.ts with `writeUsageSnapshot()`.
 */

export const USAGE_EVENT_METRICS = [
  /** Public page requests that reached the Worker, cached or not. */
  'views',
  /** Pages built by the server (cache misses, admin pages) — the best stand-in for CPU time. */
  'renders',
  /** Requests to this site's /api routes. */
  'api',
  /** Calls to an AI model: text, image, transcription and speech — every call, whoever pays. */
  'ai_calls',
  /**
   * Weighted cost of the AI calls the platform pays for (Workers AI, or the deployment's
   * own env-var keys) — what the hosting plan's AI allowance limits. Calls made with the
   * site's own API key aren't included. See ai-allowance.ts.
   */
  'ai_credits',
  /**
   * Weighted cost of platform-paid AI that visitors, incoming mail and plugins set off
   * (listen, spam checks, inbox sorting, smart search, plugin AI) — kept out of `ai_credits` so the public
   * can't use up the team's allowance. Limited by the plan's "Visitor AI credits a month".
   */
  'ai_visitor_credits',
  /** Emails handed to a real provider (console-only "sends" aren't counted). */
  'emails',
  /** Emails received at the site's own addresses and accepted (inbox and post-by-email). */
  'inbound_emails',
  /** Requests and event hooks handled by the site's dynamic plugins (each runs a Dynamic Worker). */
  'plugin_calls',
  /**
   * Minutes of the platform's Cloudflare Stream video watched. Not counted per request —
   * written hourly from Stream's analytics by video-usage.ts, as each day's total.
   */
  'video_minutes_viewed',
] as const

export const USAGE_SNAPSHOT_METRICS = [
  /** Sum of media file sizes plus inbound email kept in R2. */
  'storage_bytes',
  /** Pages, posts and every other content item, any status. */
  'content_items',
  /** People with any role except member (viewer and above), not counting the operator's super admin. */
  'team_members',
  /** People with the member role. */
  'site_members',
  /** Installed dynamic plugins. */
  'plugins',
  /** Approximate bytes the site takes in the shared D1 database (see siteDatabaseBytes()). */
  'database_bytes',
] as const

/**
 * Counted the same way as event metrics, but they are a site's own statistics, not resource
 * use — so they never appear in Super Admin → Usage or count towards a hosting plan.
 */
export const SITE_STAT_METRICS = [
  /** The signup popup was shown to a visitor (mailing-list.ts). */
  'signup_prompt_shown',
  /** A visitor closed the signup popup without signing up. */
  'signup_prompt_dismissed',
] as const

export type UsageEventMetric = typeof USAGE_EVENT_METRICS[number]
export type SiteStatMetric = typeof SITE_STAT_METRICS[number]
export type UsageSnapshotMetric = typeof USAGE_SNAPSHOT_METRICS[number]
export type UsageMetric = UsageEventMetric | UsageSnapshotMetric

// 4 bound parameters per row; D1 allows 100 per statement.
const ROWS_PER_STATEMENT = 20

export interface UsageCount {
  siteId: string
  day: string
  metric: string
  value: number
}

// Written at most once a minute, or early when 100 distinct (site, day, metric) counters wait.
const pending = createCounterBuffer<UsageCount>({ flushIntervalMs: 60_000, maxPending: 100 })

/**
 * Adds `n` to a site's count for today. Silently does nothing without a site (the accounts
 * origin, setup) — usage belongs to a site or to nobody. Never throws: counting must not
 * be able to fail the request it's counting.
 */
export function countUsage(event: H3Event, metric: UsageEventMetric | SiteStatMetric, n = 1, siteId = event.context?.siteId ?? undefined): void {
  if (!siteId || n <= 0) return
  try {
    const day = utcDay()
    const due = pending.add(`${siteId}|${day}|${metric}`, () => ({ siteId, day, metric, value: 0 }), (count) => {
      count.value += n
    })
    if (!due) return
    waitUntil(event, flushUsage(useDb(event), pending.take()).catch((err) => {
      console.error('[usage] counter write failed', err)
    }))
  } catch (err) {
    console.error('[usage] counting failed', err)
  }
}

/** Adds each buffered count to its row — one statement per ROWS_PER_STATEMENT counters. */
export async function flushUsage(db: Db, batch: UsageCount[]): Promise<void> {
  for (let i = 0; i < batch.length; i += ROWS_PER_STATEMENT) {
    await db.insert(siteUsageDaily)
      .values(batch.slice(i, i + ROWS_PER_STATEMENT))
      .onConflictDoUpdate({
        target: [siteUsageDaily.siteId, siteUsageDaily.day, siteUsageDaily.metric],
        set: { value: sql`${siteUsageDaily.value} + excluded.value`, updatedAt: sql`(datetime('now'))` },
      })
  }
}

/** Writes nightly totals, replacing any value already stored for that day. */
export async function writeUsageSnapshot(db: Db, rows: UsageCount[]): Promise<void> {
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    await db.insert(siteUsageDaily)
      .values(rows.slice(i, i + ROWS_PER_STATEMENT))
      .onConflictDoUpdate({
        target: [siteUsageDaily.siteId, siteUsageDaily.day, siteUsageDaily.metric],
        set: { value: sql`excluded.value`, updatedAt: sql`(datetime('now'))` },
      })
  }
}

/** Test hook: forget isolate-level state. */
export function resetUsageBuffer(): void {
  pending.reset()
}

/** Counts in this isolate not yet written (plan limits add them to the stored totals). */
export function pendingUsage(): UsageCount[] {
  return pending.pending()
}
