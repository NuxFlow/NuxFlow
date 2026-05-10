import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)),
    columns: { id: true, title: true },
  })
  if (!existing) throw createError({ statusCode: 404, message: 'Not found' })

  await db.delete(contentItems)
    .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))

  await writeAuditLog(event, userId, {
    action: 'delete',
    resource: 'content_item',
    resourceId: id,
    before: existing,
  })

  return { success: true }
})
