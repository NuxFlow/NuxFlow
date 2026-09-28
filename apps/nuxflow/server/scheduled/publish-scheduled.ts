import { useDb } from '../utils/db'
import { contentItems, sites } from '@nuxflow/db/schema'
import { and, eq, lte, notInArray, sql } from 'drizzle-orm'
import { indexablePathsForItems, submitToIndexNow } from '../utils/indexnow'

export const publishScheduled = async () => {
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
    columns: { id: true, siteId: true, slug: true, locale: true, sourceItemId: true, typeId: true, metaRobots: true, visibility: true },
  })

  if (due.length > 0) {
    await db.update(contentItems)
      .set({ status: 'published', publishedAt: sql`(datetime('now'))` })
      // Same predicate as the select (not an id list — D1 caps a statement at 100 bound
      // parameters). An item that became due in between is published too, just without
      // an IndexNow ping; the sitemap still covers it.
      .where(where)

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
    }
  }

  return { published: due.length }
}
