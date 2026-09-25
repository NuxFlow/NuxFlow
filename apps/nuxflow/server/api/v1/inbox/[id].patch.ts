import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { parseBody } from '../../../utils/validate'
import { getEmailMessageOrThrow } from '../../../utils/inbox'
import { writeAuditLog } from '../../../utils/audit'
import { emailMessages } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

const bodySchema = z.object({
  status: z.enum(['new', 'read', 'archived', 'spam']),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const message = await getEmailMessageOrThrow(db, siteId, id)
  await db.update(emailMessages).set({ status: body.status }).where(eq(emailMessages.id, id))
  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'email_message',
    resourceId: id,
    before: { status: message.status },
    after: { status: body.status },
  })
  return { id, status: body.status }
})
