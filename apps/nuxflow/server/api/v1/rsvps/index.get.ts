import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { eventRsvps } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { csvField } from '../../../utils/mailing-list'
import { getRsvpEvent, rsvpCounts } from '../../../utils/event-rsvp'

const querySchema = z.object({
  event: z.string().min(1).max(64),
  format: z.enum(['json', 'csv']).default('json'),
})

// The list on Admin → the event → Attendees, or as a CSV for a door list or a spreadsheet.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const { event: id, format } = parseQuery(event, querySchema)

  const item = await getRsvpEvent(db, siteId, id)
  if (!item) notFound('This event was not found.')

  const [rsvps, counts] = await Promise.all([
    db.query.eventRsvps.findMany({
      where: and(eq(eventRsvps.siteId, siteId), eq(eventRsvps.contentItemId, id)),
      orderBy: [asc(eventRsvps.createdAt), asc(eventRsvps.id)],
      limit: 5000,
    }),
    rsvpCounts(db, siteId, id),
  ])

  if (format === 'csv') {
    await writeAuditLog(event, userId, { action: 'export', resource: 'event_rsvp', resourceId: id, after: { rows: rsvps.length } })
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', `attachment; filename="attendees-${item.slug.replace(/[^a-z0-9-]/gi, '-')}.csv"`)
    setHeader(event, 'Cache-Control', 'no-store')
    const lines = rsvps.map(r => [r.name, r.email, String(r.seats), r.status, r.createdAt, r.confirmedAt, r.cancelledAt].map(csvField).join(','))
    return `name,email,places,status,asked_at,confirmed_at,cancelled_at\r\n${lines.join('\r\n')}\r\n`
  }
  return { event: item, rsvps, counts }
})
