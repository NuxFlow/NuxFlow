import { useDb } from '../utils/db'
import { contentItems, notifications } from '@nuxflow/db/schema'
import { and, eq, lt, sql } from 'drizzle-orm'
import { ulid } from 'ulid'

// Bounds how many stale items get flagged per run — same reasoning as
// MAX_OVERFLOW_ITEMS_PER_RUN in prune-old-data.ts (D1's per-invocation query ceiling).
// Re-triggerable: anything left over this run is still stale and gets caught next time.
const MAX_ITEMS_PER_RUN = 50

// How long after a "this may need a refresh" notification before the same item can be
// flagged again — without this, an author who ignores the notification would get a fresh
// one every single day this task runs, for as long as the item stays unedited.
const RENOTIFY_COOLDOWN_DAYS = 30

/**
 * Flags published content that hasn't been touched in a long time — an in-app notification
 * to the item's author, not an automated action on the content itself (no auto-unpublish,
 * no auto-edit). There's no dedicated "last flagged" column on content_items for this (see
 * CLAUDE.md's extensive caution around schema migrations on this table before adding one
 * speculatively) — instead this reuses the notifications table itself as the "already
 * notified" record: a recent `type = 'stale_content'` notification naming the same
 * `data.contentItemId` means skip it this run.
 */
export const scanStaleContent = async () => {
  const db = useDb()
  const config = useRuntimeConfig()
  const staleDays = Math.max(30, Number(config.staleContentDays) || 180)

  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
  const cooldownCutoff = new Date(Date.now() - RENOTIFY_COOLDOWN_DAYS * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)

  const staleItems = await db.query.contentItems.findMany({
    where: and(eq(contentItems.status, 'published'), lt(contentItems.updatedAt, cutoff)),
    columns: { id: true, siteId: true, authorId: true, title: true, slug: true },
    limit: MAX_ITEMS_PER_RUN,
  })

  if (!staleItems.length) return { flagged: 0, notified: 0 }

  // One query for every recent stale-content notification (across every site — this task
  // runs instance-wide, not per-site) rather than one existence-check query per stale item.
  const recentlyNotified = await db.query.notifications.findMany({
    where: and(
      eq(notifications.type, 'stale_content'),
      sql`datetime(${notifications.createdAt}) > datetime(${cooldownCutoff})`,
    ),
    columns: { data: true },
  })
  const alreadyNotifiedIds = new Set(
    recentlyNotified
      .map(n => (n.data as { contentItemId?: string } | null)?.contentItemId)
      .filter((id): id is string => Boolean(id)),
  )

  // authorId is nullable (author account may have been deleted since — see users.ts's
  // ON DELETE SET NULL) — nothing to notify in that case.
  const toNotify = staleItems.filter(item => item.authorId && !alreadyNotifiedIds.has(item.id))
  if (!toNotify.length) return { flagged: staleItems.length, notified: 0 }

  await db.insert(notifications).values(toNotify.map(item => ({
    id: ulid(),
    siteId: item.siteId,
    userId: item.authorId!,
    type: 'stale_content',
    title: 'Content may need a refresh',
    body: `"${item.title}" hasn't been updated in over ${staleDays} days — consider reviewing it for accuracy.`,
    data: { contentItemId: item.id, slug: item.slug },
  })))

  return { flagged: staleItems.length, notified: toNotify.length }
}
