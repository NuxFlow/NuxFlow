import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getEmailMessageOrThrow } from '../../../utils/inbox'
import { emailMessages, users } from '@nuxflow/db/schema'
import { and, asc, eq } from 'drizzle-orm'

/**
 * One message plus its whole thread (both directions, oldest first). Opening a 'new'
 * message marks it read. HTML bodies are returned as-is — the admin UI renders them only
 * inside a sandboxed, script-less iframe with remote content blocked by default (see
 * app/components/admin/inbox/MessageBody.vue); never inject them into the admin DOM.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const message = await getEmailMessageOrThrow(db, siteId, id)
  // Post-by-email records belong to their author, not the shared inbox.
  if (message.contentItemId) notFound('Message not found')

  if (message.status === 'new') {
    await db.update(emailMessages).set({ status: 'read' }).where(eq(emailMessages.id, id))
    message.status = 'read'
  }

  const thread = await db.select({
    id: emailMessages.id,
    direction: emailMessages.direction,
    fromAddress: emailMessages.fromAddress,
    fromName: emailMessages.fromName,
    toAddress: emailMessages.toAddress,
    subject: emailMessages.subject,
    textBody: emailMessages.textBody,
    htmlBody: emailMessages.htmlBody,
    attachments: emailMessages.attachments,
    auth: emailMessages.auth,
    status: emailMessages.status,
    category: emailMessages.category,
    aiSummary: emailMessages.aiSummary,
    sentByName: users.name,
    createdAt: emailMessages.createdAt,
  })
    .from(emailMessages)
    .leftJoin(users, eq(users.id, emailMessages.sentByUserId))
    .where(and(eq(emailMessages.siteId, siteId), eq(emailMessages.threadId, message.threadId)))
    .orderBy(asc(emailMessages.createdAt))
    .limit(100)

  return {
    message: { id: message.id, threadId: message.threadId, mailboxId: message.mailboxId, status: message.status, subject: message.subject },
    thread: thread.map(m => ({
      ...m,
      // Storage keys stay server-side — the UI downloads attachments by index.
      attachments: (m.attachments ?? []).map((a, index) => ({ index, filename: a.filename, contentType: a.contentType, size: a.size, available: !!a.key })),
    })),
  }
})
