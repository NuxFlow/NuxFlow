import { z } from 'zod'
import { requireRole } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { markUnsubscribed } from '../../../../utils/mailing-list'
import { requireSiteId } from '../../../../utils/site-context'

// An admin can take someone off the list (they asked by reply, say). Putting someone back
// on is deliberately not offered: only the person can subscribe themselves.
const bodySchema = z.object({
  status: z.literal('unsubscribed'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  await parseBody(event, bodySchema)

  if (!(await markUnsubscribed(event, siteId, id))) notFound()
  await writeAuditLog(event, userId, { action: 'update', resource: 'mailing_list_subscriber', resourceId: id, after: { status: 'unsubscribed' } })
  return { status: 'unsubscribed' }
})
