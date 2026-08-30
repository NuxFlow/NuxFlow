import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { Db } from './db'

export async function getContentItemOrThrow(
  db: Db,
  siteId: string,
  id: string,
  message = 'Content item not found',
  columns?: Record<string, boolean>,
) {
  const item = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)),
    columns,
  })
  if (!item) notFound(message)
  return item
}

export async function getContentTypeBySlugOrThrow(db: Db, siteId: string, slug: string, message = 'Content type not found', columns?: Record<string, boolean>) {
  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, slug)),
    columns,
  })
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
