import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { getTaxonomyByIdOrThrow } from '../../../utils/resource-queries'
import { taxonomies } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isHierarchical: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await getTaxonomyByIdOrThrow(db, siteId, id)

  const taxonomyUpdate = db.update(taxonomies).set(body).where(scopedById(taxonomies.id, id, taxonomies.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'taxonomy',
    resourceId: id,
    before: existing,
    after: body,
  })

  await db.batch(auditInsert ? [taxonomyUpdate, auditInsert] : [taxonomyUpdate])

  return { id }
})
