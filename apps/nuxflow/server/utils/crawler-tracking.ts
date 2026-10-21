import type { H3Event } from 'h3'
import { crawlerHits } from '@nuxflow/db/schema'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { Db } from './db'
import { useDb } from './db'
import { getAnalyticsEngine, waitUntil } from './cf-env'
import type { KnownCrawler } from './seo'

/**
 * Records one request from a known search/AI crawler (seo.ts's detectCrawler), called by
 * 05.seo-headers.ts for every public GET — including full-page-cache hits.
 *
 * Two sinks:
 * - Analytics Engine (when the `AE` binding exists), blobs `['crawler', token, category,
 *   path]` indexed by siteId — queryable with the account's AE SQL API for raw detail.
 *   The leading 'crawler' blob tells these rows apart from analytics.ts's 'view' points,
 *   which share the dataset.
 * - A daily per-bot counter in D1 (`crawler_hits`), so Admin → SEO can show crawler
 *   activity without the account-level API token the AE SQL API needs.
 *
 * Identification is by User-Agent, which a scraper can spoof — the counts show who claims
 * to be crawling, which is what robots.txt decisions are made against anyway.
 *
 * The D1 counter is not written per hit: a busy crawler can request thousands of pages a
 * day, and every write goes through the database's single primary. Hits are added up in
 * this isolate (pendingHits) and written at most once per FLUSH_INTERVAL_MS — the first hit
 * in a fresh isolate is written straight away, so a quiet site still sees every hit. Hits
 * still waiting when an isolate is shut down are lost, which is fine for a dashboard
 * that is approximate by nature. Both writes are backgrounded; a failure is logged, never
 * surfaced to the request.
 */
export function recordCrawlerHit(event: H3Event, siteId: string, crawler: KnownCrawler, path: string): void {
  const trimmedPath = path.slice(0, 256)

  const ae = getAnalyticsEngine(event)
  if (ae) {
    try {
      ae.writeDataPoint({ blobs: ['crawler', crawler.token, crawler.category, trimmedPath], doubles: [1], indexes: [siteId] })
    } catch (err) {
      console.error('[crawler-tracking] Analytics Engine write failed', err)
    }
  }

  addPendingHit(siteId, crawler, trimmedPath)
  if (!shouldFlush()) return
  const batch = takePendingHits()
  waitUntil(event, flushCrawlerHits(useDb(event), batch).catch((err) => {
    console.error('[crawler-tracking] D1 counter write failed', err)
  }))
}

const FLUSH_INTERVAL_MS = 60_000
// Flush early when this many distinct (site, day, bot) counters are waiting.
const MAX_PENDING_COUNTERS = 50

export interface PendingCrawlerHit {
  siteId: string
  day: string
  crawler: KnownCrawler
  hits: number
  lastPath: string
}

const pendingHits = new Map<string, PendingCrawlerHit>()
let lastFlushAt = 0

function addPendingHit(siteId: string, crawler: KnownCrawler, path: string, now = new Date()): void {
  const day = now.toISOString().slice(0, 10)
  const key = `${siteId}|${day}|${crawler.token}`
  const existing = pendingHits.get(key)
  if (existing) {
    existing.hits++
    existing.lastPath = path
  } else {
    pendingHits.set(key, { siteId, day, crawler, hits: 1, lastPath: path })
  }
}

function shouldFlush(): boolean {
  return Date.now() - lastFlushAt >= FLUSH_INTERVAL_MS || pendingHits.size >= MAX_PENDING_COUNTERS
}

function takePendingHits(): PendingCrawlerHit[] {
  const batch = [...pendingHits.values()]
  pendingHits.clear()
  lastFlushAt = Date.now()
  return batch
}

/** Writes buffered counters — one upsert per (site, day, bot). */
export async function flushCrawlerHits(db: Db, batch: PendingCrawlerHit[]): Promise<void> {
  for (const hit of batch) {
    // The day the hits happened, not the day they're written (a flush can cross midnight).
    await incrementCrawlerHit(db, hit.siteId, hit.crawler, hit.lastPath, new Date(`${hit.day}T12:00:00Z`), hit.hits)
  }
}

/** Test hook: forget isolate-level state. */
export function resetCrawlerHitBuffer(): void {
  pendingHits.clear()
  lastFlushAt = 0
}

export async function incrementCrawlerHit(db: Db, siteId: string, crawler: KnownCrawler, path: string, now = new Date(), hits = 1): Promise<void> {
  const day = now.toISOString().slice(0, 10)
  await db.insert(crawlerHits)
    .values({ siteId, day, bot: crawler.token, category: crawler.category, hits, lastPath: path })
    .onConflictDoUpdate({
      target: [crawlerHits.siteId, crawlerHits.day, crawlerHits.bot],
      set: { hits: sql`${crawlerHits.hits} + ${hits}`, lastPath: path, lastSeenAt: sql`(datetime('now'))` },
    })
}

export interface CrawlerActivityRow {
  bot: string
  category: string
  hits: number
  lastSeenAt: string
  lastPath: string | null
}

/** Per-bot totals over the last `days` days (UTC), busiest first. */
export async function getCrawlerActivity(db: Db, siteId: string, days: number, now = new Date()): Promise<{ since: string; bots: CrawlerActivityRow[]; daily: { day: string; category: string; hits: number }[] }> {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const where = and(eq(crawlerHits.siteId, siteId), gte(crawlerHits.day, since))

  const [bots, daily] = await Promise.all([
    db.select({
      bot: crawlerHits.bot,
      category: sql<string>`max(${crawlerHits.category})`,
      hits: sql<number>`sum(${crawlerHits.hits})`,
      lastSeenAt: sql<string>`max(${crawlerHits.lastSeenAt})`,
      // lastPath of the most recent day's row for this bot.
      lastPath: sql<string | null>`(select ch2.last_path from crawler_hits ch2 where ch2.site_id = ${siteId} and ch2.bot = ${crawlerHits.bot} order by ch2.day desc limit 1)`,
    }).from(crawlerHits).where(where).groupBy(crawlerHits.bot).orderBy(desc(sql`sum(${crawlerHits.hits})`)),
    db.select({
      day: crawlerHits.day,
      category: crawlerHits.category,
      hits: sql<number>`sum(${crawlerHits.hits})`,
    }).from(crawlerHits).where(where).groupBy(crawlerHits.day, crawlerHits.category).orderBy(crawlerHits.day),
  ])

  return {
    since,
    bots: bots.map(b => ({ ...b, hits: Number(b.hits) })),
    daily: daily.map(d => ({ ...d, hits: Number(d.hits) })),
  }
}
