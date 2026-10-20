import type { H3Event } from 'h3'
import { siteUsageDaily } from '@nuxflow/db/schema'
import { sql } from 'drizzle-orm'
import { useDb, type Db } from './db'
import { waitUntil } from './cf-env'

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
  /** Emails handed to a real provider (console-only "sends" aren't counted). */
  'emails',
] as const

export const USAGE_SNAPSHOT_METRICS = [
  /** Sum of media file sizes. */
  'storage_bytes',
  /** Pages, posts and every other content item, any status. */
  'content_items',
  /** People with any role except member (viewer and above), not counting the operator's super admin. */
  'team_members',
  /** People with the member role. */
  'site_members',
  /** Installed dynamic plugins. */
  'plugins',
] as const

export type UsageEventMetric = typeof USAGE_EVENT_METRICS[number]
export type UsageSnapshotMetric = typeof USAGE_SNAPSHOT_METRICS[number]
export type UsageMetric = UsageEventMetric | UsageSnapshotMetric

const FLUSH_INTERVAL_MS = 60_000
// Flush early when this many distinct (site, day, metric) counters are waiting.
const MAX_PENDING_COUNTERS = 100
// 4 bound parameters per row; D1 allows 100 per statement.
const ROWS_PER_STATEMENT = 20

export interface UsageCount {
  siteId: string
  day: string
  metric: string
  value: number
}

const pending = new Map<string, UsageCount>()
let lastFlushAt = 0

export function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Adds `n` to a site's count for today. Silently does nothing without a site (the accounts
 * origin, setup) — usage belongs to a site or to nobody. Never throws: counting must not
 * be able to fail the request it's counting.
 */
export function countUsage(event: H3Event, metric: UsageEventMetric, n = 1, siteId = event.context?.siteId as string | undefined): void {
  if (!siteId || n <= 0) return
  try {
    const day = usageDay()
    const key = `${siteId}|${day}|${metric}`
    const existing = pending.get(key)
    if (existing) existing.value += n
    else pending.set(key, { siteId, day, metric, value: n })

    if (Date.now() - lastFlushAt < FLUSH_INTERVAL_MS && pending.size < MAX_PENDING_COUNTERS) return
    const batch = takePendingUsage()
    waitUntil(event, flushUsage(useDb(event), batch).catch((err) => {
      console.error('[usage] counter write failed', err)
    }))
  } catch (err) {
    console.error('[usage] counting failed', err)
  }
}

function takePendingUsage(): UsageCount[] {
  const batch = [...pending.values()]
  pending.clear()
  lastFlushAt = Date.now()
  return batch
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
  pending.clear()
  lastFlushAt = 0
}

/** Test hook: what's waiting to be written. */
export function pendingUsage(): UsageCount[] {
  return [...pending.values()]
}
