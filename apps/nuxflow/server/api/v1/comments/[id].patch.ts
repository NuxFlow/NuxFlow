import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { comments } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  status: z.enum(['pending', 'approved', 'spam', 'trash']),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await db.query.comments.findFirst({
    where: and(eq(comments.id, id), eq(comments.siteId, siteId)),
  })
  if (!existing) throw notFound('Comment not found')

  await db.update(comments).set({ status: body.status }).where(eq(comments.id, id))

  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'comment',
    resourceId: id,
    before: { status: existing.status },
    after: { status: body.status },
  })

  return { id, status: body.status }
})
