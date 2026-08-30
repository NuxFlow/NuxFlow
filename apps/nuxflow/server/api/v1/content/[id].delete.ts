import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getContentItemOrThrow(db, siteId, id, 'Not found', { id: true, title: true })

  const itemDelete = db.delete(contentItems)
    .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'content_item',
    resourceId: id,
    before: existing,
  })

  await db.batch(auditInsert ? [itemDelete, auditInsert] : [itemDelete])

  return { success: true }
})
