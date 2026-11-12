import type { H3Event } from 'h3'
import { siteUsageDaily } from '@nuxflow/db/schema'
import { sql } from 'drizzle-orm'
import { useDb, type Db } from './db'
import { waitUntil } from './cf-env'
import { utcDay } from './utc-day'
import { createCounterBuffer } from './counter-buffer'
import type { UsageEventMetric } from '../../shared/lib/usage-metrics'

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

export { USAGE_EVENT_METRICS, USAGE_SNAPSHOT_METRICS } from '../../shared/lib/usage-metrics'
export type { UsageEventMetric, UsageMetric, UsageSnapshotMetric } from '../../shared/lib/usage-metrics'

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

export type SiteStatMetric = typeof SITE_STAT_METRICS[number]

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
