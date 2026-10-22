import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getCommentByIdOrThrow } from '../../../utils/resource-queries'
import { comments } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { requireSiteId } from '../../../utils/site-context'

const bodySchema = z.object({
  status: z.enum(['pending', 'approved', 'spam', 'trash']),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await getCommentByIdOrThrow(db, siteId, id)

  const commentUpdate = db.update(comments).set({ status: body.status }).where(scopedById(comments.id, id, comments.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'comment',
    resourceId: id,
    before: { status: existing.status },
    after: { status: body.status },
  })

  await batchWithAudit(db, [commentUpdate], auditInsert)

  return { id, status: body.status }
})
