import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { Db } from './db'

export async function getContentItem(db: Db, siteId: string, id: string, columns?: Record<string, boolean>) {
  return db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)),
    columns,
  })
}

export async function getContentItemOrThrow(
  db: Db,
  siteId: string,
  id: string,
  message = 'Content item not found',
  columns?: Record<string, boolean>,
) {
  const item = await getContentItem(db, siteId, id, columns)
  if (!item) notFound(message)
  return item
}

/** Non-throwing lookup — for callers that gracefully degrade (empty list, null
 * homepage, etc.) when the content type hasn't been seeded yet, as opposed to
 * `getContentTypeBySlugOrThrow` below for callers where a missing type is an error. */
export async function getContentTypeBySlug(db: Db, siteId: string, slug: string, columns?: Record<string, boolean>) {
  return db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, slug)),
    columns,
  })
}

export async function getContentTypeBySlugOrThrow(db: Db, siteId: string, slug: string, message = 'Content type not found', columns?: Record<string, boolean>) {
  const type = await getContentTypeBySlug(db, siteId, slug, columns)
  if (!type) notFound(message)
  return type
}

/**
 * The public gate (`checkContentAccess` in api/public/pages/[slug].get.ts) branches on the
 * `visibility` column, but the editor UI only ever writes the access level into
 * `settings.access` (see SeoPanel.vue). This derives the column that must stay in sync with
 * that setting so gated content is actually enforced instead of silently defaulting to public.
 */
export function deriveVisibilityFromSettings(settings: Record<string, unknown> | null | undefined): 'public' | 'members' {
  const access = (settings as { access?: string } | null)?.access
  return access && access !== 'public' ? 'members' : 'public'
}
