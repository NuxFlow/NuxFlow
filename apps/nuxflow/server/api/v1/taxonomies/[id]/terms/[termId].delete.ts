import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../../utils/audit'
import { getTaxonomyByIdOrThrow, getTaxonomyTermByIdOrThrow } from '../../../../../utils/resource-queries'
import { purgeContentCache } from '../../../../../utils/edge-cache'
import { getTermRefsWithAncestors, purgeTaxonomyCache } from '../../../../../utils/taxonomy'
import { contentItems, contentTaxonomyTerms, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const termId = getRouterParam(event, 'termId')!

  const taxonomy = await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)
  const term = await getTaxonomyTermByIdOrThrow(db, taxonomyId, termId)

  // Resolved before the delete (assignments cascade away with the term): the term's own
  // archive plus its ancestors' (which rolled its items up), and the pages that showed it.
  const refs = await getTermRefsWithAncestors(db, [termId])
  const taggedItems = await db.selectDistinct({ slug: contentItems.slug })
    .from(contentTaxonomyTerms)
    .innerJoin(contentItems, eq(contentItems.id, contentTaxonomyTerms.contentItemId))
    .where(and(eq(contentTaxonomyTerms.termId, termId), eq(contentItems.status, 'published')))
    .limit(500)

  // Move any child terms up to the deleted term's own parent rather than leaving them
  // pointing at a deleted id — taxonomyTerms.parentId has no DB-level FK (see the schema
  // comment for why: the required table-rebuild migration would silently null every
  // parentId in the table via its own ON DELETE SET NULL action mid-migration), so this
  // is the only thing preventing a dangling reference here.
  const reparentChildren = db.update(taxonomyTerms)
    .set({ parentId: term.parentId ?? null })
    .where(and(eq(taxonomyTerms.taxonomyId, taxonomyId), eq(taxonomyTerms.parentId, termId)))

  const termDelete = db.delete(taxonomyTerms).where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'taxonomy_term',
    resourceId: termId,
    before: term,
  })

  await batchWithAudit(db, [reparentChildren, termDelete], auditInsert)

  await purgeTaxonomyCache(event, db, { taxonomySlugs: [taxonomy.slug] })
  await purgeContentCache(event, { slugs: taggedItems.map(i => i.slug), taxonomyTerms: refs })

  return noContent(event)
})
