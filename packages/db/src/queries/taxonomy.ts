import { contentTaxonomyTerms, taxonomyTerms, taxonomies } from '../schema'
import { and, eq } from 'drizzle-orm'
import type { Db } from './types'

/** All taxonomy terms (with their parent taxonomy) assigned to one content item. */
export async function getContentItemTerms(db: Db, siteId: string, itemId: string) {
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
    .where(and(eq(contentTaxonomyTerms.contentItemId, itemId), eq(taxonomies.siteId, siteId)))
}
