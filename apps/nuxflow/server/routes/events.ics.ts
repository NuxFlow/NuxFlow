import type { H3Event } from 'h3'
import { buildIcsCalendar } from '@nuxflow/canvas/events'
import { useReplicaDb } from '../utils/db'
import { getContentTypeBySlug } from '../utils/content-queries'
import { contentItems, sites } from '@nuxflow/db/schema'
import { eq, and, gte, asc, isNull } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { lastEventDate, toIcsEvent } from '../utils/event-feed'
import { publicPathForItem } from '../utils/seo'

/** Most events in the subscription feed — plenty for a calendar app. */
const FEED_LIMIT = 500

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

  const calendar = { domain: site.domain, timeZone: site.timezone || 'UTC', name: `${site.name} Events` }
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
      gte(lastEventDate, ninetyDaysAgo.toISOString()),
    ),
    // Earliest first with a LIMIT, so what a very long list drops is the furthest away
    // rather than the events coming up next.
    orderBy: [asc(contentItems.eventStartAt)],
    limit: FEED_LIMIT,
    columns: { id: true, slug: true, title: true, excerpt: true, eventStartAt: true, eventEndAt: true, eventAllDay: true, eventLocation: true, eventUrl: true, updatedAt: true },
  })

  const origin = getRequestURL(event).origin
  return buildIcsCalendar({
    ...calendar,
    events: rows.map(row => toIcsEvent(row, `${origin}${publicPathForItem({ slug: row.slug }, site.locale || 'en')}`)),
  })
}
