import { useDb } from '../utils/db'
import { contentItems, sites } from '@nuxflow/db/schema'
import { and, eq, lte, notInArray, sql } from 'drizzle-orm'
import { indexablePathsForItems, submitToIndexNow } from '../utils/indexnow'
import { bumpCacheVersionInKv } from '../utils/cache-version'
import { createSystemEvent } from '../utils/system-event'
import { dispatchContentHook } from '../utils/plugin-hooks'

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
    // reactivated, at which point anything overdue publishes on the next tick.
    notInArray(contentItems.siteId, db.select({ id: sites.id }).from(sites).where(eq(sites.status, 'suspended'))),
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

    // Newly published items belong in their site's blog index, feeds, sitemaps and term
    // archives — start a new cache version per affected site so those show them within
    // about a minute, not after the cache's hour-long lifetime. Tasks run without a
    // request, so the KV binding comes from the env Nitro sets on globalThis.
    const kv = (globalThis as { __env__?: { PLUGIN_KV?: KVNamespace } }).__env__?.PLUGIN_KV ?? null
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
      // Plugins granted `hook:content.published`. Needs the Worker's env and context (the
      // plugin is spawned through LOADER and handed ctx.exports stubs), which only the
      // Cloudflare cron path provides.
      if (cloudflare) {
        const event = createSystemEvent({ env: cloudflare.env, ctx: cloudflare.context, siteId })
        const publishedAt = new Date().toISOString()
        for (const item of items) {
          await dispatchContentHook(event, siteId, { status: 'scheduled', visibility: item.visibility }, { status: 'published', visibility: item.visibility }, { ...item, publishedAt })
            .catch(err => console.error(`[publish-scheduled] Plugin hook failed for ${item.id}:`, err))
        }
      }
    }
  }

  return { published: due.length }
}
