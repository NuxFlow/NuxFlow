import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentTypes, taxonomies, taxonomyContentTypes, taxonomyTerms } from '@nuxflow/db/schema'
import type { Db } from './db'
import { validationError } from './response'

// Server half of the WordPress import. The admin page parses the export in the browser
// (shared/lib/wxr-parser.ts) and drives these routes one small batch at a time —
// server/api/v1/import/wordpress/{terms,term-parents,media,items,finish}.post.ts — so no
// single request has to hold a whole export (a big one exceeded the Worker's 128 MB of
// memory) or run thousands of D1 queries (D1 allows 1,000 per request). Every step is safe
// to retry: terms, media and items all reuse what an earlier attempt already created.

/** D1 caps a statement at 100 bound parameters; lookups by a list stay well under it. */
export const IN_LIST_CHUNK = 90

export const WORDPRESS_TAXONOMIES = {
  category: { slug: 'category', name: 'Categories', isHierarchical: true },
  tag: { slug: 'tag', name: 'Tags', isHierarchical: false },
} as const
export type WordPressTaxonomy = keyof typeof WORDPRESS_TAXONOMIES

export function chunked<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** The site's built-in page and post content types; an import needs both. */
export async function getImportContentTypes(db: Db, siteId: string): Promise<{ pageTypeId: string; postTypeId: string }> {
  const rows = await db.query.contentTypes.findMany({
    where: and(eq(contentTypes.siteId, siteId), inArray(contentTypes.slug, ['page', 'post'])),
    columns: { id: true, slug: true },
  })
  const pageTypeId = rows.find(r => r.slug === 'page')?.id
  const postTypeId = rows.find(r => r.slug === 'post')?.id
  if (!pageTypeId || !postTypeId) validationError('Content types not found — run setup first')
  return { pageTypeId: pageTypeId!, postTypeId: postTypeId! }
}

/** The site's category or tag taxonomy, created (scoped to posts) if it doesn't exist yet. */
export async function ensureImportTaxonomy(db: Db, siteId: string, which: WordPressTaxonomy, postTypeId: string): Promise<string> {
  const def = WORDPRESS_TAXONOMIES[which]
  const existing = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, def.slug)),
    columns: { id: true },
  })
  if (existing) return existing.id
  const id = ulid()
  await db.insert(taxonomies).values({ id, siteId, slug: def.slug, name: def.name, isHierarchical: def.isHierarchical })
  // WordPress categories/tags are post taxonomies.
  await db.insert(taxonomyContentTypes).values({ taxonomyId: id, contentTypeId: postTypeId })
  return id
}

/** slug → id for the given slugs in one taxonomy. */
export async function termIdsBySlug(db: Db, taxonomyId: string, slugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const part of chunked([...new Set(slugs)], IN_LIST_CHUNK)) {
    const rows = await db.query.taxonomyTerms.findMany({
      where: and(eq(taxonomyTerms.taxonomyId, taxonomyId), inArray(taxonomyTerms.slug, part)),
      columns: { id: true, slug: true },
    })
    for (const r of rows) out.set(r.slug, r.id)
  }
  return out
}
