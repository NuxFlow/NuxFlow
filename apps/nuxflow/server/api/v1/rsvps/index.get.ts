import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { eventRsvps } from '@nuxflow/db/schema'
import { formatEventWhen, upcomingOccurrences } from '@nuxflow/canvas/events'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { csvField } from '../../../utils/mailing-list'
import { getRsvpEvent, rsvpCounts, slotOf } from '../../../utils/event-rsvp'

const querySchema = z.object({
  event: z.string().min(1).max(64),
  // One date of a repeating event. Without it, a one-off's list, or the whole series'.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(['json', 'csv']).default('json'),
})

/** Upcoming dates listed in the picker, along with any that already have bookings. */
const PICKER_DATES = 60

// The list on Admin → the event → Attendees, or as a CSV for a door list or a spreadsheet.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const { event: id, date, format } = parseQuery(event, querySchema)

  const item = await getRsvpEvent(db, siteId, id)
  if (!item) notFound('This event was not found.')

  const [rsvps, counts] = await Promise.all([
    db.query.eventRsvps.findMany({
      where: and(eq(eventRsvps.siteId, siteId), eq(eventRsvps.contentItemId, id), date ? eq(eventRsvps.occurrenceDate, date) : undefined),
      orderBy: [asc(eventRsvps.createdAt), asc(eventRsvps.id)],
      limit: 5000,
    }),
    rsvpCounts(db, siteId, id, date),
  ])

  if (format === 'csv') {
    await writeAuditLog(event, userId, { action: 'export', resource: 'event_rsvp', resourceId: id, after: { rows: rsvps.length } })
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', `attachment; filename="attendees-${item.slug.replace(/[^a-z0-9-]/gi, '-')}${date ? `-${date}` : ''}.csv"`)
    setHeader(event, 'Cache-Control', 'no-store')
    const lines = rsvps.map(r => [r.name, r.email, String(r.seats), r.status, r.occurrenceDate, r.paymentMethod, r.paymentStatus, r.amountPaid == null ? null : String(r.amountPaid), r.currency, r.createdAt, r.confirmedAt, r.cancelledAt].map(csvField).join(','))
    return `name,email,places,status,date,paid_by,payment,amount,currency,asked_at,confirmed_at,cancelled_at\r\n${lines.join('\r\n')}\r\n`
  }

  // A date worked out from the rule, plus any older date the list still has bookings on.
  let dates: Array<{ date: string; when: string }> | null = null
  if (item.eventRecurrence && item.eventStartAt) {
    const times = { eventStartAt: item.eventStartAt, eventEndAt: item.eventEndAt, eventAllDay: item.eventAllDay }
    const fromRule = upcomingOccurrences(times, item.eventRecurrence, item.timeZone, PICKER_DATES).map(o => o.date)
    const booked = await db.selectDistinct({ date: eventRsvps.occurrenceDate }).from(eventRsvps)
      .where(and(eq(eventRsvps.siteId, siteId), eq(eventRsvps.contentItemId, id)))
    dates = [...new Set([...fromRule, ...booked.map(b => b.date).filter(Boolean)])].sort().map((day) => {
      const slot = slotOf(item, day)
      return { date: day, when: slot ? formatEventWhen({ eventStartAt: slot.eventStartAt ?? '', eventEndAt: slot.eventEndAt, eventAllDay: slot.eventAllDay }, item.timeZone, item.locale) : `${day} (no longer on the schedule)` }
    })
  }
  return { event: item, rsvps, counts, dates }
})
