import { useDb } from '../utils/db'
import { contentItems, sites } from '@nuxflow/db/schema'
import { and, eq, isNotNull, lte, notInArray, or, sql } from 'drizzle-orm'
import { indexablePathsForItems, submitToIndexNow } from '../utils/indexnow'
import { bumpCacheVersionInKv } from '../utils/cache-version'
import { createSystemEvent } from '../utils/system-event'
import { dispatchContentHook } from '../utils/plugin-hooks'
import { pushContentPublished } from '../utils/push-content'
import { archiveReplacedTranslations } from '../utils/content-queries'

/** What Nitro hands a Cloudflare cron task (`context.cloudflare`). */
export interface ScheduledCloudflareContext {
  env: unknown
  context: { waitUntil(promise: Promise<unknown>): void }
}

export const publishScheduled = async (cloudflare?: ScheduledCloudflareContext) => {
  const db = useDb()

  const where = and(
    eq(contentItems.status, 'scheduled'),
    lte(contentItems.scheduledAt, sql`(datetime('now'))`),
    // A suspended site is closed by the operator — nothing on it changes until it's
    // reactivated, at which point anything overdue publishes on the next tick. A site being
    // moved between pools (utils/site-move.ts) waits too, so a post goes out once, from
    // its new home.
    notInArray(contentItems.siteId, db.select({ id: sites.id }).from(sites).where(or(eq(sites.status, 'suspended'), isNotNull(sites.moveState)))),
  )

  const due = await db.query.contentItems.findMany({
    where,
    columns: { id: true, siteId: true, slug: true, title: true, locale: true, sourceItemId: true, typeId: true, metaRobots: true, visibility: true },
  })

  if (due.length > 0) {
    await db.update(contentItems)
      .set({ status: 'published', publishedAt: sql`(datetime('now'))` })
      // Same predicate as the select (not an id list — D1 caps a statement at 100 bound
      // parameters). An item that became due in between is published too, just without
      // an IndexNow ping; the sitemap still covers it.
      .where(where)

    // A scheduled translation retires the live one in its language, as publishing by hand
    // does. One call per language: two due at once for the same one leave the last standing
    // (calling it for both would have each archive the other).
    const byLanguage = new Map(due.filter(i => i.sourceItemId).map(i => [`${i.siteId}:${i.sourceItemId}:${i.locale}`, i]))
    for (const item of byLanguage.values()) {
      await archiveReplacedTranslations(db, item.siteId, item)
    }

    // Newly published items belong in their site's blog index, feeds, sitemaps and term
    // archives — start a new cache version per affected site so those show them within
    // about a minute, not after the cache's hour-long lifetime. Tasks run without a
    // request, so the KV binding comes from the env Nitro sets on globalThis.
    const kv = globalThis.__env__?.PLUGIN_KV ?? null
    for (const siteId of new Set(due.map(item => item.siteId))) {
      await bumpCacheVersionInKv(kv, siteId)
    }

    // IndexNow for sites that opted in — grouped per site since each has its own key and
    // host. Best-effort: a failed ping never fails the publish.
    const bySite = new Map<string, typeof due>()
    for (const item of due) {
      if (item.visibility !== 'public') continue
      bySite.set(item.siteId, [...(bySite.get(item.siteId) ?? []), item])
    }
    for (const [siteId, items] of bySite) {
      try {
        await submitToIndexNow(db, siteId, await indexablePathsForItems(db, siteId, items))
      } catch (err) {
        console.error(`[publish-scheduled] IndexNow notification failed for site ${siteId}:`, err)
      }
      const env = cloudflare?.env ?? globalThis.__env__
      const event = createSystemEvent({ env, ctx: cloudflare?.context, siteId })
      const publishedAt = new Date().toISOString()
      for (const item of items) {
        const before = { status: 'scheduled', visibility: item.visibility }
        const after = { status: 'published', visibility: item.visibility }
        // Plugins granted `hook:content.published`. Needs the Worker's env and context (the
        // plugin is spawned through LOADER and handed ctx.exports stubs), which only the
        // Cloudflare cron path provides.
        if (cloudflare) {
          await dispatchContentHook(event, siteId, before, after, { ...item, publishedAt })
            .catch(err => console.error(`[publish-scheduled] Plugin hook failed for ${item.id}:`, err))
        }
        // The "New content published" push (Settings → Push) — scheduled posts never sent it.
        await pushContentPublished(event, siteId, before, after, item)
          .catch(err => console.error(`[publish-scheduled] Push broadcast failed for ${item.id}:`, err))
      }
    }
  }

  return { published: due.length }
}
