import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getTaxonomyByIdOrThrow } from '../../../utils/resource-queries'
import { purgeTaxonomyCache } from '../../../utils/taxonomy'
import { purgeContentCache } from '../../../utils/edge-cache'
import { contentItems, contentTaxonomyTerms, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { scopedById } from '../../../utils/db-helpers'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getTaxonomyByIdOrThrow(db, siteId, id)
  const terms = await db.select({ id: taxonomyTerms.id, slug: taxonomyTerms.slug })
    .from(taxonomyTerms)
    .where(eq(taxonomyTerms.taxonomyId, id))

  // Resolved before the delete (the assignments cascade away with the terms) so the
  // pages that showed these terms can be purged afterwards.
  const taggedItems = terms.length
    ? await db.selectDistinct({ slug: contentItems.slug })
        .from(contentTaxonomyTerms)
        .innerJoin(contentItems, eq(contentItems.id, contentTaxonomyTerms.contentItemId))
        .where(and(inArray(contentTaxonomyTerms.termId, terms.map(t => t.id)), eq(contentItems.status, 'published')))
        .limit(500)
    : []

  const taxonomyDelete = db.delete(taxonomies).where(scopedById(taxonomies.id, id, taxonomies.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'taxonomy',
    resourceId: id,
    before: existing,
  })

  await batchWithAudit(db, [taxonomyDelete], auditInsert)

  await purgeTaxonomyCache(event, db, { taxonomySlugs: [existing.slug] })
  await purgeContentCache(event, {
    slugs: taggedItems.map(i => i.slug),
    taxonomyTerms: terms.map(t => ({ taxonomySlug: existing.slug, termSlug: t.slug })),
  })

  return noContent(event)
})
