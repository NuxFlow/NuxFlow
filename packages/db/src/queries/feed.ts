import { contentItems, contentTaxonomyTerms, sites, users } from '../schema'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from './types'

/**
 * Shared by feed.xml.ts and atom.xml.ts — both list the same published/public posts.
 * `termIds` narrows the feed to items tagged with any of them (a per-term feed).
 */
export async function getPublishedPostsForFeed(db: Db, siteId: string, limit = 20, termIds?: string[]) {
  return db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      slug: contentItems.slug,
      excerpt: contentItems.excerpt,
      content: contentItems.content,
      ogImage: contentItems.ogImage,
      publishedAt: contentItems.publishedAt,
      updatedAt: contentItems.updatedAt,
      authorName: users.name,
    })
    .from(contentItems)
    .leftJoin(users, eq(contentItems.authorId, users.id))
    .where(and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.status, 'published'),
      eq(contentItems.visibility, 'public'),
      termIds
        ? inArray(contentItems.id, db.selectDistinct({ id: contentTaxonomyTerms.contentItemId })
            .from(contentTaxonomyTerms)
            .where(inArray(contentTaxonomyTerms.termId, termIds.length ? termIds : [''])))
        : undefined,
    ))
    .orderBy(desc(contentItems.publishedAt))
    .limit(limit)
}

export async function getFeedSite(db: Db, siteId: string) {
  return db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { name: true, domain: true },
  })
}
