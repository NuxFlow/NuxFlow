import { useDb } from '../../../../utils/db'
import { contentItems, contentTaxonomyTerms, taxonomyTerms, taxonomies } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomySlug = getRouterParam(event, 'taxonomySlug')!
  const termSlug = getRouterParam(event, 'termSlug')!

  const taxonomy = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, taxonomySlug)),
    columns: { id: true, name: true, slug: true },
  })
  if (!taxonomy) throw createError({ statusCode: 404, message: 'Taxonomy not found' })

  const term = await db.query.taxonomyTerms.findFirst({
    where: and(eq(taxonomyTerms.taxonomyId, taxonomy.id), eq(taxonomyTerms.slug, termSlug)),
    columns: { id: true, name: true, slug: true, description: true },
  })
  if (!term) throw createError({ statusCode: 404, message: 'Term not found' })

  const rows = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      slug: contentItems.slug,
      excerpt: contentItems.excerpt,
      publishedAt: contentItems.publishedAt,
    })
    .from(contentItems)
    .innerJoin(contentTaxonomyTerms, eq(contentTaxonomyTerms.contentItemId, contentItems.id))
    .where(and(
      eq(contentTaxonomyTerms.termId, term.id),
      eq(contentItems.siteId, siteId),
      eq(contentItems.status, 'published'),
    ))
    .orderBy(desc(contentItems.publishedAt))
    .limit(50)

  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  return { taxonomy, term, items: rows }
})
