import { contentItems } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { createIsolateCache } from './isolate-cache'
import type { Db } from './db'

// server/api/public/pages/[slug].get.ts needs this set to tell a locale-prefixed URL
// segment (e.g. "es/about") apart from an ordinary literal slug — but a plain
// `GROUP BY locale` over content_items is a full-table scan, and it used to run on
// *every* request whose first path segment wasn't already one of the ~15 hardcoded
// SUPPORTED_LOCALES codes — i.e. most ordinary slugs ("home", "about", "blog", ...) on
// the single hottest route in the app. A site's set of active locales changes only when
// someone publishes the first item in a new locale, so a short cache is a safe trade:
// worst case, a URL in a locale added in the last 60s briefly 404s as a literal slug
// instead of resolving as a locale prefix, exactly like any other propagation-lag cache
// in this codebase (settings.ts, theme-cache.ts).
const _cache = createIsolateCache<Set<string>>(60_000)

export async function getActiveLocales(db: Db, siteId: string): Promise<Set<string>> {
  const cached = _cache.get(siteId)
  if (cached) return cached

  const rows = await db.select({ locale: contentItems.locale })
    .from(contentItems)
    .where(eq(contentItems.siteId, siteId))
    .groupBy(contentItems.locale)

  const activeSet = new Set(rows.map(r => r.locale).filter(Boolean) as string[])
  _cache.set(siteId, activeSet)
  return activeSet
}
