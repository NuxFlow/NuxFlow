import { and, eq } from 'drizzle-orm'
import { emailMessages, mailboxes } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { noContent } from '../../../utils/response'

/**
 * Deletes an inbox address. Its messages are kept — they just lose their mailbox link
 * (email_messages.mailbox_id is a plain column for exactly this) and drop out of the
 * inbox list, which filters by mailbox. Disable the mailbox instead to stop receiving
 * but keep the history visible.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const mailbox = await db.query.mailboxes.findFirst({
    where: and(eq(mailboxes.id, id), eq(mailboxes.siteId, siteId), eq(mailboxes.kind, 'inbox')),
  })
  if (!mailbox) notFound('Mailbox not found')

  await db.batch([
    db.update(emailMessages).set({ mailboxId: null }).where(and(eq(emailMessages.siteId, siteId), eq(emailMessages.mailboxId, id))),
    db.delete(mailboxes).where(eq(mailboxes.id, id)),
  ])
  await writeAuditLog(event, userId, { action: 'delete', resource: 'mailbox', resourceId: id, before: { localPart: mailbox.localPart } })
  return noContent(event)
})
