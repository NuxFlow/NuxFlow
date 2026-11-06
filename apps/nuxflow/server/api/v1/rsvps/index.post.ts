import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { requireSiteId } from '../../../utils/site-context'
import { writeAuditLog } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { purgeContentCache } from '../../../utils/edge-cache'
import { addRsvpByOrganiser, cancelEventDate, getRsvpEvent, slotOf } from '../../../utils/event-rsvp'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()

const bodySchema = z.discriminatedUnion('action', [
  // Adds someone to the list by hand, e.g. a booking taken over the phone.
  z.object({
    action: z.literal('add').default('add'),
    event: z.string().min(1).max(64),
    // Which date of a repeating event.
    date,
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().max(254).email(),
    seats: z.number().int().min(1).max(1000).default(1),
  }),
  // Calls off a date: everyone booked gets their money or credits back and an email. A
  // repeating event carries on without that date.
  z.object({
    action: z.literal('cancel-date'),
    event: z.string().min(1).max(64),
    date,
  }),
])

// One address rather than two: the route count is what tips `nuxt typecheck` over its depth
// limit (see CLAUDE.md, Events system).
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const siteId = requireSiteId(event)
  const body = await parseBody(event, bodySchema)

  const item = await getRsvpEvent(useDb(event), siteId, body.event)
  if (!item) notFound('This event was not found.')

  if (body.action === 'cancel-date') {
    if (item.eventRecurrence && !body.date) validationError('Please choose a date.')
    const result = await cancelEventDate(event, item, item.eventRecurrence ? body.date! : '')
    await purgeContentCache(event, { published: true, slugs: [item.slug] })
    await writeAuditLog(event, userId, { action: 'update', resource: 'event_rsvp', resourceId: item.id, after: { cancelledDate: body.date ?? 'event', ...result } })
    return result
  }

  const slot = slotOf(item, body.date)
  if (!slot) validationError('Please choose a date.')
  const id = await addRsvpByOrganiser(event, slot, { name: body.name, email: body.email, seats: body.seats })
  await writeAuditLog(event, userId, { action: 'create', resource: 'event_rsvp', resourceId: id, after: { contentItemId: item.id, date: body.date, seats: body.seats } })
  return created(event, { id })
})
