import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { parseQuery } from '../../../utils/validate'
import { parsePagination } from '../../../utils/pagination'
import { countUnreadInbox } from '../../../utils/inbox'
import { emailMessages, mailboxes } from '@nuxflow/db/schema'
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm'

const querySchema = z.object({
  // 'inbox' = everything not yet archived or marked spam.
  folder: z.enum(['inbox', 'new', 'archived', 'spam']).default('inbox'),
  mailboxId: z.string().optional(),
  category: z.enum(['lead', 'support', 'other']).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
})

/**
 * Received messages for Admin → Inbox, newest first. Lists individual inbound messages
 * (a reply from a customer is a new row needing attention), not threads — the detail
 * route returns the whole thread. Only 'inbox'-kind mailboxes; post-by-email records
 * belong to their author and never show here.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = parseQuery(event, querySchema)
  const { limit, offset, page } = parsePagination(query, 50, 100)

  const conditions = [
    eq(emailMessages.siteId, siteId),
    eq(emailMessages.direction, 'inbound'),
    eq(mailboxes.kind, 'inbox'),
  ]
  if (query.folder === 'inbox') conditions.push(inArray(emailMessages.status, ['new', 'read']))
  else conditions.push(eq(emailMessages.status, query.folder))
  if (query.mailboxId) conditions.push(eq(emailMessages.mailboxId, query.mailboxId))
  if (query.category) conditions.push(eq(emailMessages.category, query.category))
  const q = query.q?.trim().replace(/[%_]/g, '')
  if (q) {
    const term = `%${q}%`
    conditions.push(or(like(emailMessages.subject, term), like(emailMessages.fromAddress, term), like(emailMessages.fromName, term))!)
  }

  const where = and(...conditions)
  const [rows, [total], unread] = await Promise.all([
    db.select({
      id: emailMessages.id,
      threadId: emailMessages.threadId,
      mailboxId: emailMessages.mailboxId,
      mailboxName: mailboxes.name,
      fromAddress: emailMessages.fromAddress,
      fromName: emailMessages.fromName,
      toAddress: emailMessages.toAddress,
      subject: emailMessages.subject,
      snippet: emailMessages.snippet,
      status: emailMessages.status,
      category: emailMessages.category,
      aiSummary: emailMessages.aiSummary,
      attachmentCount: sql<number>`coalesce(json_array_length(${emailMessages.attachments}), 0)`,
      createdAt: emailMessages.createdAt,
    })
      .from(emailMessages)
      .innerJoin(mailboxes, eq(mailboxes.id, emailMessages.mailboxId))
      .where(where)
      .orderBy(desc(emailMessages.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ n: sql<number>`count(*)` }).from(emailMessages)
      .innerJoin(mailboxes, eq(mailboxes.id, emailMessages.mailboxId))
      .where(where),
    countUnreadInbox(db, siteId),
  ])

  return { messages: rows, total: total?.n ?? 0, unread, page, limit }
})
