import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { buildAuditLogInsert } from '../../../../../utils/audit'
import { getTaxonomyByIdOrThrow, getTaxonomyTermByIdOrThrow } from '../../../../../utils/resource-queries'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const termId = getRouterParam(event, 'termId')!

  await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)
  const term = await getTaxonomyTermByIdOrThrow(db, taxonomyId, termId)

  const termDelete = db.delete(taxonomyTerms).where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'taxonomy_term',
    resourceId: termId,
    before: term,
  })

  await db.batch(auditInsert ? [termDelete, auditInsert] : [termDelete])

  return noContent(event)
})
