import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getEmailMessageOrThrow, deleteEmailObjects } from '../../../utils/inbox'
import { writeAuditLog } from '../../../utils/audit'
import { noContent } from '../../../utils/response'
import { emailMessages } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

/** Permanently deletes one message (not its whole thread) and its stored R2 objects. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const message = await getEmailMessageOrThrow(db, siteId, id)
  await db.delete(emailMessages).where(eq(emailMessages.id, id))
  await deleteEmailObjects(event, message)
  await writeAuditLog(event, userId, {
    action: 'delete',
    resource: 'email_message',
    resourceId: id,
    before: { from: message.fromAddress, subject: message.subject },
  })
  return noContent(event)
})
