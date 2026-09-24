import type { H3Event } from 'h3'
import { and, eq, gt } from 'drizzle-orm'
import { contentItems } from '@nuxflow/db/schema'
import type { Db } from './db'

// Set by GET /api/preview/:token, read by GET /api/public/pages/:slug.
export const PREVIEW_COOKIE = '__nuxflow_preview'

// Matches the cookie lifetime set in api/preview/[token].get.ts. The token itself stays
// valid for 48h (preview-link.post.ts); the cookie just limits how long one browser keeps
// using it without re-opening the link.
export const PREVIEW_COOKIE_MAX_AGE_SECONDS = 60 * 60

/**
 * The content item this browser's preview cookie unlocks for `slug`, or null. The token
 * must belong to this site, match this exact slug (a token for one draft never exposes a
 * different one), and still be within its expiry. Always reads the primary DB: a token
 * generated seconds ago must work immediately, which a read replica can't guarantee.
 */
export async function findPreviewItem(event: H3Event, db: Db, siteId: string, slug: string) {
  const token = getCookie(event, PREVIEW_COOKIE)
  if (!token) return null
  const item = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.slug, slug),
      eq(contentItems.previewToken, token),
      gt(contentItems.previewTokenExpiresAt, new Date().toISOString()),
    ),
  })
  return item ?? null
}
