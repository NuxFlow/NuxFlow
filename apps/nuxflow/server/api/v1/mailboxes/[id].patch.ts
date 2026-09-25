import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { mailboxes } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { parseBody } from '../../../utils/validate'
import { writeAuditLog } from '../../../utils/audit'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  forwardTo: z.email().max(254).nullish(),
  notify: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

// The local part can't be changed — mail already sent to the old address would silently
// start bouncing. Create a new mailbox and disable the old one instead.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const mailbox = await db.query.mailboxes.findFirst({
    where: and(eq(mailboxes.id, id), eq(mailboxes.siteId, siteId), eq(mailboxes.kind, 'inbox')),
  })
  if (!mailbox) notFound('Mailbox not found')

  const update = {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.forwardTo !== undefined && { forwardTo: body.forwardTo?.toLowerCase() || null }),
    ...(body.notify !== undefined && { notify: body.notify }),
    ...(body.enabled !== undefined && { enabled: body.enabled }),
  }
  if (Object.keys(update).length) {
    await db.update(mailboxes).set({ ...update, updatedAt: sql`(datetime('now'))` }).where(eq(mailboxes.id, id))
    await writeAuditLog(event, userId, { action: 'update', resource: 'mailbox', resourceId: id, before: { name: mailbox.name, forwardTo: mailbox.forwardTo, notify: mailbox.notify, enabled: mailbox.enabled }, after: update })
  }
  return { id }
})
