import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getCommentByIdOrThrow } from '../../../utils/resource-queries'
import { comments } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getCommentByIdOrThrow(db, siteId, id)

  // Promote any replies to top-level rather than leaving them pointing at a deleted
  // parent id — comments.parentId has no DB-level FK (see the schema comment for why:
  // the required table-rebuild migration would silently null every parentId in the table
  // via its own ON DELETE SET NULL action mid-migration), so this is the only thing
  // preventing a dangling reference here.
  const reparentReplies = db.update(comments)
    .set({ parentId: null })
    .where(and(eq(comments.siteId, siteId), eq(comments.parentId, id)))

  const commentDelete = db.delete(comments).where(scopedById(comments.id, id, comments.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'comment',
    resourceId: id,
    before: existing,
  })

  await batchWithAudit(db, [reparentReplies, commentDelete], auditInsert)

  return noContent(event)
})
