import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { contentTaxonomyTerms, taxonomyTerms, taxonomies } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const itemId = getRouterParam(event, 'id')!

  await getContentItemOrThrow(db, siteId, itemId, 'Content item not found', { id: true })

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
