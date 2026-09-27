import type { H3Event } from 'h3'
import { crawlerHits } from '@nuxflow/db/schema'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { Db } from './db'
import { useDb } from './db'
import { getAnalyticsEngine, waitUntil } from './cf-env'
import type { KnownCrawler } from './seo'

/**
 * Records one request from a known search/AI crawler (seo.ts's detectCrawler), called by
 * 05.seo-headers.ts for every public GET — including full-page-cache hits, which never
 * reach the page API's own trackPageView().
 *
 * Two sinks:
 * - Analytics Engine (when the `AE` binding exists), blobs `['crawler', token, category,
 *   path]` indexed by siteId — queryable with the account's AE SQL API for raw detail.
 *   The leading 'crawler' blob tells these rows apart from trackPageView's page views,
 *   which share the dataset.
 * - A daily per-bot counter in D1 (`crawler_hits`), so Admin → SEO can show crawler
 *   activity without the account-level API token the AE SQL API needs.
 *
 * Identification is by User-Agent, which a scraper can spoof — the counts show who claims
 * to be crawling, which is what robots.txt decisions are made against anyway. Both writes
 * are backgrounded; a failure is logged, never surfaced to the request.
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

  waitUntil(event, incrementCrawlerHit(useDb(event), siteId, crawler, trimmedPath).catch((err) => {
    console.error('[crawler-tracking] D1 counter write failed', err)
  }))
}

export async function incrementCrawlerHit(db: Db, siteId: string, crawler: KnownCrawler, path: string, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10)
  await db.insert(crawlerHits)
    .values({ siteId, day, bot: crawler.token, category: crawler.category, hits: 1, lastPath: path })
    .onConflictDoUpdate({
      target: [crawlerHits.siteId, crawlerHits.day, crawlerHits.bot],
      set: { hits: sql`${crawlerHits.hits} + 1`, lastPath: path, lastSeenAt: sql`(datetime('now'))` },
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
