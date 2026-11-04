import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { eventRsvps } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { emailOrganiserChange, getRsvpEvent, setRsvpStatus } from '../../../utils/event-rsvp'

const bodySchema = z.object({
  status: z.enum(['confirmed', 'waitlist', 'cancelled']),
})

// The organiser moves someone: off the waitlist (even past the capacity), back onto it, or
// off the list. The person is told by email.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const rsvpId = getRouterParam(event, 'id')!
  const { status } = await parseBody(event, bodySchema)

  const row = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.id, rsvpId), eq(eventRsvps.siteId, siteId)),
  })
  const item = await getRsvpEvent(db, siteId, row?.contentItemId ?? '')
  if (!row || !item) notFound('That booking was not found.')
  if (row.status === status) return { id: row.id, status }

  await setRsvpStatus(event, row, status)
  await emailOrganiserChange(event, item, row, status)
  await writeAuditLog(event, userId, { action: 'update', resource: 'event_rsvp', resourceId: row.id, before: { status: row.status }, after: { status } })
  return { id: row.id, status }
})
