import type { H3Event } from 'h3'
import { addDays, buildIcsCalendar, todayIn } from '@nuxflow/canvas/events'
import { useReplicaDb } from '../utils/db'
import { getContentTypeBySlug } from '../utils/content-queries'
import { contentItems, sites } from '@nuxflow/db/schema'
import { eq, and, gte, asc, isNotNull, isNull, or } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { expandSeries, lastEventDate, toIcsEvent } from '../utils/event-feed'
import { publicPathForItem } from '../utils/seo'

/** Most events in the subscription feed — plenty for a calendar app. */
const FEED_LIMIT = 500

/** How far ahead a repeating event's dates are listed; the feed rolls forward by itself. */
const SERIES_DAYS_AHEAD = 180

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId
  if (!siteId) throw notFound()

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  return withEdgeCache(event, 3600, () => buildEventsIcs(event, siteId))
})

async function buildEventsIcs(event: H3Event, siteId: string) {
  // Anonymous, read-only, edge-cached — safe to read from a D1 read replica when one is
  // enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)

  const [site, type] = await Promise.all([
    db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { name: true, domain: true, timezone: true, locale: true },
    }),
    getContentTypeBySlug(db, siteId, 'event', { id: true }),
  ])
  if (!site) throw notFound()

  const timeZone = site.timezone || 'UTC'
  const calendar = { domain: site.domain, timeZone, name: `${site.name} Events` }
  if (!type) return buildIcsCalendar({ ...calendar, events: [] })

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const rows = await db.query.contentItems.findMany({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.typeId, type.id),
      eq(contentItems.status, 'published'),
      // Public subscription feed — private/members-only events must not appear here.
      eq(contentItems.visibility, 'public'),
      // A translation is the same event, not another one.
      isNull(contentItems.sourceItemId),
      // A series' first date can be long gone with more still to come.
      or(gte(lastEventDate, ninetyDaysAgo.toISOString()), isNotNull(contentItems.eventRecurrence)),
    ),
    // Earliest first with a LIMIT, so what a very long list drops is the furthest away
    // rather than the events coming up next.
    orderBy: [asc(contentItems.eventStartAt)],
    limit: FEED_LIMIT,
    columns: { id: true, slug: true, title: true, excerpt: true, eventStartAt: true, eventEndAt: true, eventAllDay: true, eventLocation: true, eventUrl: true, eventRecurrence: true, updatedAt: true },
  })

  const origin = getRequestURL(event).origin
  const today = todayIn(timeZone)
  const pageUrl = (slug: string) => `${origin}${publicPathForItem({ slug }, site.locale || 'en')}`
  const entries = rows.flatMap((row) => {
    if (!row.eventRecurrence) return [toIcsEvent(row, pageUrl(row.slug))]
    return expandSeries(row, timeZone, addDays(today, -30), addDays(today, SERIES_DAYS_AHEAD))
      .map(date => toIcsEvent({ ...date, id: `${row.id}-${date.date}` }, `${pageUrl(row.slug)}?date=${date.date}`))
  })
  return buildIcsCalendar({ ...calendar, events: entries.slice(0, FEED_LIMIT * 4) })
}
