import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { addDays, buildIcsCalendar, todayIn } from '@nuxflow/canvas/events'
import { contentItems, sites } from '@nuxflow/db/schema'
import { useReplicaDb } from '../../../utils/db'
import { withEdgeCache } from '../../../utils/edge-cache'
import { expandSeries, toIcsEvent } from '../../../utils/event-feed'
import { publicPathForItem } from '../../../utils/seo'
import { requireSiteId } from '../../../utils/site-context'
import { parseQuery } from '../../../utils/validate'

const querySchema = z.object({
  // One date of a repeating event. Without it, the dates coming up.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
})

/** How far ahead a repeating event's own file lists dates when no date is asked for. */
const SERIES_DAYS_AHEAD = 90

// One event's "Add to calendar" file, linked from the event page and the Calendar block.
// Public events only, the same as the subscription feed at /events.ics.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const { date } = parseQuery(event, querySchema)

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="event.ics"')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  setHeader(event, 'X-Robots-Tag', 'noindex')

  return withEdgeCache(event, 3600, async () => {
    const db = useReplicaDb(event)
    const [row, site] = await Promise.all([
      db.query.contentItems.findFirst({
        where: and(
          eq(contentItems.id, id),
          eq(contentItems.siteId, siteId),
          eq(contentItems.status, 'published'),
          eq(contentItems.visibility, 'public'),
        ),
        columns: { id: true, slug: true, title: true, excerpt: true, eventStartAt: true, eventEndAt: true, eventAllDay: true, eventLocation: true, eventUrl: true, eventRecurrence: true, updatedAt: true },
      }),
      db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true, timezone: true, locale: true } }),
    ])
    if (!row?.eventStartAt || !site) notFound('This event was not found.')
    const timeZone = site.timezone || 'UTC'
    const pageUrl = `${getRequestURL(event).origin}${publicPathForItem({ slug: row.slug }, site.locale || 'en')}`

    if (!row.eventRecurrence) {
      return buildIcsCalendar({ domain: site.domain, timeZone, events: [toIcsEvent(row, pageUrl)] })
    }
    const today = todayIn(timeZone)
    const dates = date
      ? expandSeries(row, timeZone, date, date)
      : expandSeries(row, timeZone, today, addDays(today, SERIES_DAYS_AHEAD))
    if (date && dates.length === 0) notFound('This event was not found.')
    return buildIcsCalendar({
      domain: site.domain,
      timeZone,
      events: dates.map(d => toIcsEvent({ ...d, id: `${row.id}-${d.date}` }, `${pageUrl}?date=${d.date}`)),
    })
  })
})
