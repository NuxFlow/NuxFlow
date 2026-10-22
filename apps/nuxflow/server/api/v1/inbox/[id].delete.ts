import { useDb } from '../../../utils/db'
import { scopedById } from '../../../utils/db-helpers'
import { requireRole } from '../../../utils/permissions'
import { getEmailMessageOrThrow, deleteEmailObjects } from '../../../utils/inbox'
import { writeAuditLog } from '../../../utils/audit'
import { noContent } from '../../../utils/response'
import { emailMessages } from '@nuxflow/db/schema'
import { requireSiteId } from '../../../utils/site-context'

/** Permanently deletes one message (not its whole thread) and its stored R2 objects. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const message = await getEmailMessageOrThrow(db, siteId, id)
  await db.delete(emailMessages).where(scopedById(emailMessages.id, id, emailMessages.siteId, siteId))
  await deleteEmailObjects(event, message)
  await writeAuditLog(event, userId, {
    action: 'delete',
    resource: 'email_message',
    resourceId: id,
    before: { from: message.fromAddress, subject: message.subject },
  })
  return noContent(event)
})
