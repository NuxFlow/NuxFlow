import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { addDays, buildIcsCalendar } from '@nuxflow/canvas/events'
import { contentItems, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { exportBlocks, verifyAvailabilityExportToken } from '../../../utils/availability'
import { requireSiteId } from '../../../utils/site-context'
import { parseQuery } from '../../../utils/validate'
import { notFound } from '../../../utils/response'

const querySchema = z.object({ token: z.string().max(128).default('') })

// A holiday let's own blocked nights as a calendar file, for Airbnb, Booking.com and the like
// to import (server/utils/availability.ts). Only the nights added in the editor — never what
// came from a booking site, or each site would echo the others' bookings back. The link
// carries an HMAC of the page, so it works before the page is published and can't be guessed.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const id = (getRouterParam(event, 'id') ?? '').replace(/\.ics$/i, '')
  const { token } = parseQuery(event, querySchema)
  if (!await verifyAvailabilityExportToken(siteId, id, token)) throw notFound()

  const db = useDb(event)
  const [item, site] = await Promise.all([
    db.query.contentItems.findFirst({ where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)), columns: { id: true, title: true } }),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true, timezone: true } }),
  ])
  if (!item || !site) throw notFound()
  const blocks = await exportBlocks(db, siteId, item.id)

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  setHeader(event, 'Cache-Control', 'private, max-age=300')
  setHeader(event, 'X-Robots-Tag', 'noindex')
  return buildIcsCalendar({
    domain: site.domain,
    timeZone: site.timezone || 'UTC',
    name: item.title,
    events: blocks.map(b => ({
      id: `availability-${b.id}`,
      title: b.note || 'Not available',
      // An all-day event's end is its last day; the block's end is the day they leave.
      eventStartAt: b.startDate,
      eventEndAt: addDays(b.endDate, -1),
      eventAllDay: true,
      updatedAt: b.createdAt,
    })),
  })
})
