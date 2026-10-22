import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { scopedById } from '../../../utils/db-helpers'
import { requireRole } from '../../../utils/permissions'
import { parseBody } from '../../../utils/validate'
import { getEmailMessageOrThrow } from '../../../utils/inbox'
import { writeAuditLog } from '../../../utils/audit'
import { emailMessages } from '@nuxflow/db/schema'
import { requireSiteId } from '../../../utils/site-context'

const bodySchema = z.object({
  status: z.enum(['new', 'read', 'archived', 'spam']),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const message = await getEmailMessageOrThrow(db, siteId, id)
  await db.update(emailMessages).set({ status: body.status }).where(scopedById(emailMessages.id, id, emailMessages.siteId, siteId))
  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'email_message',
    resourceId: id,
    before: { status: message.status },
    after: { status: body.status },
  })
  return { id, status: body.status }
})
