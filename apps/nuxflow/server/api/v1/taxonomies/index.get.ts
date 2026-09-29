import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { getTaxonomyContentTypeSlugs } from '../../../utils/taxonomy'
import { taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { asc, eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const rows = await db.select({
    id: taxonomies.id,
    slug: taxonomies.slug,
    name: taxonomies.name,
    description: taxonomies.description,
    isHierarchical: taxonomies.isHierarchical,
    noindex: taxonomies.noindex,
    createdAt: taxonomies.createdAt,
    termCount: sql<number>`(SELECT count(*) FROM ${taxonomyTerms} WHERE ${taxonomyTerms.taxonomyId} = ${taxonomies.id})`,
  })
    .from(taxonomies)
    .where(eq(taxonomies.siteId, siteId))
    .orderBy(asc(taxonomies.name))

  // Empty contentTypes = the taxonomy applies to every content type.
  const typesByTaxonomy = await getTaxonomyContentTypeSlugs(db, rows.map(r => r.id))

  return {
    taxonomies: rows.map(r => ({ ...r, termCount: Number(r.termCount), contentTypes: typesByTaxonomy.get(r.id) ?? [] })),
  }
})
