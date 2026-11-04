import { and, eq } from 'drizzle-orm'
import { buildIcsCalendar } from '@nuxflow/canvas/events'
import { contentItems, sites } from '@nuxflow/db/schema'
import { useReplicaDb } from '../../../utils/db'
import { withEdgeCache } from '../../../utils/edge-cache'
import { toIcsEvent } from '../../../utils/event-feed'
import { publicPathForItem } from '../../../utils/seo'
import { requireSiteId } from '../../../utils/site-context'

// One event's "Add to calendar" file, linked from the event page and the Calendar block.
// Public events only, the same as the subscription feed at /events.ics.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

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
        columns: { id: true, slug: true, title: true, excerpt: true, eventStartAt: true, eventEndAt: true, eventAllDay: true, eventLocation: true, eventUrl: true, updatedAt: true },
      }),
      db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true, timezone: true, locale: true } }),
    ])
    if (!row?.eventStartAt || !site) notFound('This event was not found.')
    const pageUrl = `${getRequestURL(event).origin}${publicPathForItem({ slug: row.slug }, site.locale || 'en')}`
    return buildIcsCalendar({ domain: site.domain, timeZone: site.timezone || 'UTC', events: [toIcsEvent(row, pageUrl)] })
  })
})
