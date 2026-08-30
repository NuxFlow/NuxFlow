import { contentItems, sites, users } from '@nuxflow/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { Db } from './db'

/** Shared by feed.xml.ts and atom.xml.ts — both list the same published/public posts. */
export async function getPublishedPostsForFeed(db: Db, siteId: string, limit = 20) {
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
    .where(and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public')))
    .orderBy(desc(contentItems.publishedAt))
    .limit(limit)
}

export async function getFeedSite(db: Db, siteId: string) {
  return db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { name: true, domain: true },
  })
}
