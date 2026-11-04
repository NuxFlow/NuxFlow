import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { addRsvpByOrganiser, getRsvpEvent } from '../../../utils/event-rsvp'

const bodySchema = z.object({
  event: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254).email(),
  seats: z.number().int().min(1).max(1000).default(1),
})

// Adds someone to the list by hand, e.g. a booking taken over the phone.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const siteId = requireSiteId(event)
  
  const { event: itemId, ...body } = await parseBody(event, bodySchema)
  if (!(await getRsvpEvent(useDb(event), siteId, itemId))) notFound('This event was not found.')

  const id = await addRsvpByOrganiser(event, itemId, body)
  await writeAuditLog(event, userId, { action: 'create', resource: 'event_rsvp', resourceId: id, after: { contentItemId: itemId, seats: body.seats } })
  return created(event, { id })
})
