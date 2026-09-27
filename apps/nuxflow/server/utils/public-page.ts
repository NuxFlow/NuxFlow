import { contentItems, sites } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { Db } from './db'
import { getActiveLocales } from './locale-cache'
import { publicPathForItem } from './seo'

type ContentItemRow = typeof contentItems.$inferSelect

// Locale codes recognized as a URL prefix without a DB lookup; any other code becomes a
// valid prefix as soon as the site has content in it (getActiveLocales).
export const SUPPORTED_LOCALES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ja', 'zh-CN', 'zh-TW', 'ko', 'ar', 'ru', 'hi',
])

/**
 * Splits an optional locale prefix off a public path (`es/about` → `{ locale: 'es',
 * slug: 'about' }`, `es` → the Spanish homepage). Shared by the public pages API and the
 * Markdown alternate so both resolve exactly the same URLs.
 */
export async function parseLocalePath(db: Db, siteId: string, slugPath: string): Promise<{ locale: string | null; slug: string }> {
  const parts = slugPath.split('/')
  const candidate = parts[0]
  if (candidate && candidate.length >= 2 && candidate.length <= 10) {
    const isLocale = SUPPORTED_LOCALES.has(candidate) || (await getActiveLocales(db, siteId)).has(candidate)
    if (isLocale) return { locale: candidate, slug: parts.slice(1).join('/') || 'home' }
  }
  return { locale: null, slug: slugPath }
}

/**
 * Finds the published item for a (locale-stripped) slug: the exact slug first, then — for
 * a locale-prefixed URL — its linked translation in that locale. A translated URL whose
 * translation doesn't exist (or isn't published) falls back to the original rather than
 * 404ing; callers point the canonical at the original in that case.
 */
export async function findPublishedPage(db: Db, siteId: string, slug: string, locale: string | null): Promise<ContentItemRow | null> {
  const page = await db.query.contentItems.findFirst({
    where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, slug), eq(contentItems.status, 'published')),
  })
  if (!page || !locale || page.locale === locale) return page ?? null

  const sourceId = page.sourceItemId || page.id
  const translation = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.sourceItemId, sourceId),
      eq(contentItems.locale, locale),
      eq(contentItems.status, 'published'),
    ),
  })
  return translation ?? page
}

/**
 * The public path of one item (see seo.ts's publicPathForItem) — resolves the source
 * item's slug and the site's default locale itself, for callers that only have the row.
 */
export async function itemPublicPath(
  db: Db,
  siteId: string,
  item: { slug: string; locale?: string | null; sourceItemId?: string | null },
): Promise<string> {
  const [site, source] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { locale: true } }),
    item.sourceItemId
      ? db.query.contentItems.findFirst({ where: and(eq(contentItems.id, item.sourceItemId), eq(contentItems.siteId, siteId)), columns: { slug: true } })
      : Promise.resolve(null),
  ])
  return publicPathForItem({ slug: item.slug, locale: item.locale, sourceSlug: source?.slug ?? null }, site?.locale || 'en')
}
