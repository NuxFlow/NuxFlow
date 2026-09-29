import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getTaxonomyByIdOrThrow } from '../../../../utils/resource-queries'
import { contentTaxonomyTerms, taxonomyTerms } from '@nuxflow/db/schema'
import { asc, eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!

  await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)

  const rows = await db.select({
    id: taxonomyTerms.id,
    slug: taxonomyTerms.slug,
    name: taxonomyTerms.name,
    description: taxonomyTerms.description,
    parentId: taxonomyTerms.parentId,
    sortOrder: taxonomyTerms.sortOrder,
    seoTitle: taxonomyTerms.seoTitle,
    seoDescription: taxonomyTerms.seoDescription,
    ogImage: taxonomyTerms.ogImage,
    createdAt: taxonomyTerms.createdAt,
    // Items of any status tagged with the term directly — what an editor needs to judge
    // whether a term is in use before renaming or deleting it.
    count: sql<number>`(SELECT count(*) FROM ${contentTaxonomyTerms} WHERE ${contentTaxonomyTerms.termId} = ${taxonomyTerms.id})`,
  })
    .from(taxonomyTerms)
    .where(eq(taxonomyTerms.taxonomyId, taxonomyId))
    .orderBy(asc(taxonomyTerms.sortOrder), asc(taxonomyTerms.name))

  return { terms: rows.map(r => ({ ...r, count: Number(r.count) })) }
})
