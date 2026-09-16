import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../../utils/audit'
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

  // Promote any child terms to top-level rather than leaving them pointing at a deleted
  // parent id — taxonomyTerms.parentId has no DB-level FK (see the schema comment for
  // why: the required table-rebuild migration would silently null every parentId in the
  // table via its own ON DELETE SET NULL action mid-migration), so this is the only thing
  // preventing a dangling reference here.
  const reparentChildren = db.update(taxonomyTerms)
    .set({ parentId: null })
    .where(and(eq(taxonomyTerms.taxonomyId, taxonomyId), eq(taxonomyTerms.parentId, termId)))

  const termDelete = db.delete(taxonomyTerms).where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'taxonomy_term',
    resourceId: termId,
    before: term,
  })

  await batchWithAudit(db, [reparentChildren, termDelete], auditInsert)

  return noContent(event)
})
