import type { H3Event } from 'h3'
import { z } from 'zod'
import { useReplicaDb } from '../../utils/db'
import { parseQuery } from '../../utils/validate'
import { getContentTypeBySlug } from '../../utils/content-queries'
import { contentItems, sites } from '@nuxflow/db/schema'
import { and, eq, gte, lte, asc, desc, isNull } from 'drizzle-orm'
import { notFound } from '../../utils/response'
import { withEdgeCache } from '../../utils/edge-cache'
import { eventIcsPath, eventTimeframe, lastEventDate } from '../../utils/event-feed'
import { publicPathForItem } from '../../utils/seo'

// Out-of-range numbers are clamped rather than refused, so a block with an odd setting still renders.
const querySchema = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  // Without from/to: what's on now and next, or (past=1) what has finished, latest first.
  past: z.enum(['0', '1']).catch('0'),
  limit: z.coerce.number().int().catch(20).transform(n => Math.min(100, Math.max(1, n))),
  offset: z.coerce.number().int().catch(0).transform(n => Math.max(0, n)),
})

async function loadEvents(event: H3Event, siteId: string) {
  // Anonymous, read-only and edge-cached — fine to read from a D1 replica.
  const db = useReplicaDb(event)
  const { from, to, past, limit, offset } = parseQuery(event, querySchema)

  // Find the event content type ID
  const [type, site] = await Promise.all([
    getContentTypeBySlug(db, siteId, 'event', { id: true }),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { timezone: true, locale: true } }),
  ])
  if (!type) return { events: [] }
  const timeZone = site?.timezone || 'UTC'

  const conditions = [
    eq(contentItems.siteId, siteId),
    eq(contentItems.typeId, type.id),
    eq(contentItems.status, 'published'),
    // Same rule as every other anonymous surface (posts, feeds, sitemap, taxonomy
    // archives): private/members-only events must not be listed here.
    eq(contentItems.visibility, 'public'),
    // A translation is the same event, not another one.
    isNull(contentItems.sourceItemId),
  ]

  const hasWindow = Boolean(from || to)
  if (hasWindow) {
    // Anything overlapping the window, so a month grid shows a conference that began the month before.
    if (from) conditions.push(gte(lastEventDate, from))
    if (to) conditions.push(lte(contentItems.eventStartAt, to))
  }
  else {
    conditions.push(eventTimeframe(past === '1' ? 'past' : 'upcoming', new Date(), timeZone))
  }

  // Soonest first — this is an "upcoming events" list, so a descending sort plus LIMIT
  // would drop the nearest events once there are more than `limit` of them.
  // Only the fields CanvasBlockCalendar renders: the full row would include the event's
  // body (`content`) and settings, which this anonymous, edge-cached route must not expose.
  const rows = await db.query.contentItems.findMany({
    where: and(...conditions),
    orderBy: [!hasWindow && past === '1' ? desc(contentItems.eventStartAt) : asc(contentItems.eventStartAt)],
    limit,
    offset,
    columns: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      eventStartAt: true,
      eventEndAt: true,
      eventAllDay: true,
      eventLocation: true,
      eventUrl: true,
      eventRsvpEnabled: true,
    },
  })

  const events = rows.map(({ eventRsvpEnabled, ...row }) => ({
    ...row,
    path: publicPathForItem({ slug: row.slug }, site?.locale || 'en'),
    icsUrl: eventIcsPath(row.id),
    rsvp: Boolean(eventRsvpEnabled),
  }))
  return { events, timeZone, feedUrl: '/events.ics' }
}

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId
  if (!siteId) notFound()

  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  // Fully public, unauthenticated calendar-block data. Short TTL (5 min, not the usual
  // 1h) because what counts as "upcoming" moves with the clock — the cached result is only
  // ever as fresh as whichever request first populated the cache for this exact URL.
  return withEdgeCache(event, 300, () => loadEvents(event, siteId))
})
