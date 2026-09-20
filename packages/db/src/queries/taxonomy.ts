import { contentItems, contentTaxonomyTerms, taxonomyTerms, taxonomies } from '../schema'
import { and, eq, desc, sql } from 'drizzle-orm'
import { paginate } from './paginate'
import type { Db } from './types'

/** All taxonomy terms (with their parent taxonomy) assigned to one content item. */
export async function getContentItemTerms(db: Db, itemId: string) {
  return db
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
}

/** Published content items tagged with a given taxonomy term, paginated, with total count. */
export async function getItemsForTerm(db: Db, siteId: string, termId: string, opts: { limit: number; offset: number }) {
  const matchCondition = and(
    eq(contentTaxonomyTerms.termId, termId),
    eq(contentItems.siteId, siteId),
    eq(contentItems.status, 'published'),
    eq(contentItems.visibility, 'public'),
  )

  // Not countRows() — that helper only supports a plain `.from(table).where(where)` count,
  // and this count needs the same join as the rows query. paginate() itself is
  // table/query-builder-agnostic (it just bundles two thunks), so it still applies here.
  return paginate(
    () => db
      .select({ total: sql<number>`count(*)` })
      .from(contentItems)
      .innerJoin(contentTaxonomyTerms, eq(contentTaxonomyTerms.contentItemId, contentItems.id))
      .where(matchCondition),
    () => db
      .select({
        id: contentItems.id,
        title: contentItems.title,
        slug: contentItems.slug,
        excerpt: contentItems.excerpt,
        ogImage: contentItems.ogImage,
        publishedAt: contentItems.publishedAt,
      })
      .from(contentItems)
      .innerJoin(contentTaxonomyTerms, eq(contentTaxonomyTerms.contentItemId, contentItems.id))
      .where(matchCondition)
      .orderBy(desc(contentItems.publishedAt))
      .limit(opts.limit)
      .offset(opts.offset),
  )
}
