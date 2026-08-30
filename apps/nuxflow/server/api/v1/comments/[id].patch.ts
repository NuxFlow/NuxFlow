import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { getCommentByIdOrThrow } from '../../../utils/resource-queries'
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

  const existing = await getCommentByIdOrThrow(db, siteId, id)

  const commentUpdate = db.update(comments).set({ status: body.status }).where(and(eq(comments.id, id), eq(comments.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'comment',
    resourceId: id,
    before: { status: existing.status },
    after: { status: body.status },
  })

  await db.batch(auditInsert ? [commentUpdate, auditInsert] : [commentUpdate])

  return { id, status: body.status }
})
