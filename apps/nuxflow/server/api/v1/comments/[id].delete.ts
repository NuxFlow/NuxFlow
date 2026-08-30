import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { getCommentByIdOrThrow } from '../../../utils/resource-queries'
import { comments } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getCommentByIdOrThrow(db, siteId, id)

  const commentDelete = db.delete(comments).where(and(eq(comments.id, id), eq(comments.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'comment',
    resourceId: id,
    before: existing,
  })

  await db.batch(auditInsert ? [commentDelete, auditInsert] : [commentDelete])

  return { success: true }
})
