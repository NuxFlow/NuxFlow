import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { buildAuditLogInsert } from '../../../../../utils/audit'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const termId = getRouterParam(event, 'termId')!

  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, taxonomyId), eq(taxonomies.siteId, siteId)),
  })
  if (!taxonomy) throw notFound('Taxonomy not found')

  const term = await db.query.taxonomyTerms.findFirst({
    where: and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)),
  })

  const termDelete = db.delete(taxonomyTerms).where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'taxonomy_term',
    resourceId: termId,
    before: term,
  })

  await db.batch(auditInsert ? [termDelete, auditInsert] : [termDelete])

  return { success: true }
})
