import { contentTaxonomyTerms, taxonomyTerms, taxonomies } from '../schema'
import { eq } from 'drizzle-orm'
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
