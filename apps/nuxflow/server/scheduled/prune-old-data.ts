import { useDb } from '../utils/db'
import { auditLogs, contentRevisions, rateLimits, notifications } from '@nuxflow/db/schema'
import { and, count, eq, lt, notInArray, sql, isNotNull, or } from 'drizzle-orm'

export const pruneOldData = async () => {
  const db = useDb()
  const config = useRuntimeConfig()

  const auditLogRetentionDays = Math.max(1, Number(config.auditLogRetentionDays) || 90)
  const revisionRetentionCount = Math.max(1, Number(config.revisionRetentionCount) || 20)

  // --- Audit logs ---
  // Cutoff as SQLite-compatible datetime string (space separator, no trailing Z)
  const cutoffDate = new Date(Date.now() - auditLogRetentionDays * 86_400_000)
    .toISOString().replace('T', ' ').slice(0, 19)

  const [auditRow] = await db
    .select({ value: count() })
    .from(auditLogs)
    .where(lt(auditLogs.createdAt, cutoffDate))

  const prunedAuditLogs = auditRow?.value ?? 0
  if (prunedAuditLogs > 0) {
    await db.delete(auditLogs).where(lt(auditLogs.createdAt, cutoffDate))
  }

  // --- Content revisions ---
  // Find all items that have more revisions than the retention limit
  const overflowItems = await db
    .select({ itemId: contentRevisions.itemId, total: count() })
    .from(contentRevisions)
    .groupBy(contentRevisions.itemId)
    .having(sql`count(*) > ${revisionRetentionCount}`)

  // Fetch the IDs of the N most-recent revisions to keep, per overflowing item
  const keepLists = await Promise.all(overflowItems.map(({ itemId }) =>
    db.query.contentRevisions.findMany({
      where: eq(contentRevisions.itemId, itemId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: revisionRetentionCount,
      columns: { id: true },
    }),
  ))

  const deleteStatements = overflowItems
    .map(({ itemId }, i) => ({ itemId, keep: keepLists[i]! }))
    .filter(({ keep }) => keep.length > 0)
    .map(({ itemId, keep }) => db.delete(contentRevisions)
      .where(and(
        eq(contentRevisions.itemId, itemId),
        notInArray(contentRevisions.id, keep.map(r => r.id)),
      )))

  if (deleteStatements.length > 0) {
    await db.batch(deleteStatements as [typeof deleteStatements[number], ...typeof deleteStatements])
  }

  const prunedRevisions = overflowItems.reduce((sum, { total }, i) => sum + (total - keepLists[i]!.length), 0)

  // --- Rate limit rows ---
  // The D1 fallback tier of rateLimit() upserts one row per distinct (keyPrefix, siteId,
  // ip) it ever sees — bounded by distinct keys, not request volume, but still unbounded
  // over a public site's life (bot/scraper traffic naturally rotates IPs). Nothing else
  // ever deletes an expired row, so this is the only cleanup path for this table.
  const [rateLimitRow] = await db
    .select({ value: count() })
    .from(rateLimits)
    .where(sql`datetime(${rateLimits.resetAt}) < datetime('now')`)
  const prunedRateLimits = rateLimitRow?.value ?? 0
  if (prunedRateLimits > 0) {
    await db.delete(rateLimits).where(sql`datetime(${rateLimits.resetAt}) < datetime('now')`)
  }

  // --- Notifications ---
  // No retention policy existed for this table at all — every content-published/
  // payment-confirmed/etc. event inserts a permanent row with no expiry. Read
  // notifications are pruned quickly (their in-app purpose is done once seen); unread
  // ones get the same longer cutoff as audit logs as a hard cap so an inactive user
  // can't accumulate notifications forever.
  const notificationReadCutoff = new Date(Date.now() - 30 * 86_400_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const notificationHardCutoff = cutoffDate

  const notificationsWhere = or(
    and(isNotNull(notifications.readAt), lt(notifications.createdAt, notificationReadCutoff)),
    lt(notifications.createdAt, notificationHardCutoff),
  )
  const [notificationRow] = await db
    .select({ value: count() })
    .from(notifications)
    .where(notificationsWhere)
  const prunedNotifications = notificationRow?.value ?? 0
  if (prunedNotifications > 0) {
    await db.delete(notifications).where(notificationsWhere)
  }

  return { prunedAuditLogs, prunedRevisions, prunedRateLimits, prunedNotifications }
}
