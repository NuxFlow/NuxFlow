import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { contentTaxonomyTerms, taxonomyTerms, taxonomies, contentItems } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const itemId = getRouterParam(event, 'id')!

  const item = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, itemId), eq(contentItems.siteId, siteId)),
    columns: { id: true },
  })
  if (!item) throw createError({ statusCode: 404, message: 'Content item not found' })

  const rows = await db
    .select({
      termId: contentTaxonomyTerms.termId,
      termSlug: taxonomyTerms.slug,
      termName: taxonomyTerms.name,
      taxonomyId: taxonomyTerms.taxonomyId,
      taxonomySlug: taxonomies.slug,
      taxonomyName: taxonomies.name,
    })
    .from(contentTaxonomyTerms)
    .innerJoin(taxonomyTerms, eq(contentTaxonomyTerms.termId, taxonomyTerms.id))
    .innerJoin(taxonomies, eq(taxonomyTerms.taxonomyId, taxonomies.id))
    .where(eq(contentTaxonomyTerms.contentItemId, itemId))

  return { terms: rows }
})
