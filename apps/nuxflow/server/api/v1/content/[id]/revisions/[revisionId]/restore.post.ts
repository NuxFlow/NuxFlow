import { useDb } from '../../../../../../utils/db'
import { requireRole } from '../../../../../../utils/permissions'
import { writeAuditLog } from '../../../../../../utils/audit'
import { contentRevisions, contentItems } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const revisionId = getRouterParam(event, 'revisionId')!

  const revision = await db.query.contentRevisions.findFirst({
    where: and(eq(contentRevisions.id, revisionId), eq(contentRevisions.itemId, id)),
  })
  if (!revision) throw createError({ statusCode: 404, message: 'Revision not found' })

  await db.update(contentItems)
    .set({ title: revision.title, content: revision.content, updatedAt: sql`(datetime('now'))` })
    .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))

  await writeAuditLog(event, userId, { action: 'restore', resource: 'content_revision', resourceId: revisionId })
  return { success: true }
})
