import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { getTaxonomyByIdOrThrow } from '../../../utils/resource-queries'
import { taxonomies } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getTaxonomyByIdOrThrow(db, siteId, id)

  const taxonomyDelete = db.delete(taxonomies).where(and(eq(taxonomies.id, id), eq(taxonomies.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'taxonomy',
    resourceId: id,
    before: existing,
  })

  await db.batch(auditInsert ? [taxonomyDelete, auditInsert] : [taxonomyDelete])

  return { success: true }
})
