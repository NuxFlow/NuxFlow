import { and, eq } from 'drizzle-orm'
import { eventRsvps } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { noContent } from '../../../utils/response'
import { promoteWaitlist } from '../../../utils/event-rsvp'

// Erases someone from the list altogether, e.g. when they ask for their details to be removed.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const rsvpId = getRouterParam(event, 'id')!

  const row = await db.query.eventRsvps.findFirst({
    where: and(eq(eventRsvps.id, rsvpId), eq(eventRsvps.siteId, siteId)),
    columns: { id: true, status: true, contentItemId: true },
  })
  if (!row) notFound('That booking was not found.')

  await db.delete(eventRsvps).where(and(eq(eventRsvps.id, row.id), eq(eventRsvps.siteId, siteId)))
  if (row.status === 'confirmed') await promoteWaitlist(event, row.contentItemId)
  await writeAuditLog(event, userId, { action: 'delete', resource: 'event_rsvp', resourceId: row.id })
  return noContent(event)
})
