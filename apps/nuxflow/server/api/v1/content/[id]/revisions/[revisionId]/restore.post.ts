import { useDb } from '../../../../../../utils/db'
import { requireRole } from '../../../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../../../utils/audit'
import { getContentItemOrThrow } from '../../../../../../utils/content-queries'
import { contentRevisions, contentItems } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { scopedById } from '../../../../../../utils/db-helpers'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const revisionId = getRouterParam(event, 'revisionId')!

  await getContentItemOrThrow(db, siteId, id, 'Content item not found')

  const revision = await db.query.contentRevisions.findFirst({
    where: and(eq(contentRevisions.id, revisionId), eq(contentRevisions.itemId, id)),
  })
  if (!revision) throw notFound('Revision not found')

  const itemUpdate = db.update(contentItems)
    .set({ title: revision.title, content: revision.content, updatedAt: sql`(datetime('now'))` })
    .where(scopedById(contentItems.id, id, contentItems.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'restore', resource: 'content_revision', resourceId: revisionId })

  await batchWithAudit(db, [itemUpdate], auditInsert)
  return { success: true }
})
