import { useDb } from '../utils/db'
import { auditLogs, contentRevisions } from '@nuxflow/db/schema'
import { and, count, eq, lt, notInArray, sql } from 'drizzle-orm'

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

  let prunedRevisions = 0

  for (const { itemId, total } of overflowItems) {
    // Fetch the IDs of the N most-recent revisions — these are the ones to keep
    const keep = await db.query.contentRevisions.findMany({
      where: eq(contentRevisions.itemId, itemId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: revisionRetentionCount,
      columns: { id: true },
    })

    if (keep.length > 0) {
      await db.delete(contentRevisions)
        .where(and(
          eq(contentRevisions.itemId, itemId),
          notInArray(contentRevisions.id, keep.map(r => r.id)),
        ))
      prunedRevisions += total - keep.length
    }
  }

  return { prunedAuditLogs, prunedRevisions }
}
