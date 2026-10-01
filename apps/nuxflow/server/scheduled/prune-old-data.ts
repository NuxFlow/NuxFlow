import { useDb } from '../utils/db'
import { aiGenerationJobs, auditLogs, contentRevisions, rateLimits, notifications, emailLog, emailMessages, crawlerHits, siteInvitations, siteAuthCodes, siteSessions } from '@nuxflow/db/schema'
import { and, count, eq, inArray, lt, ne, notInArray, sql, isNotNull, or } from 'drizzle-orm'

// Bounds how many overflowing content items get their excess revisions pruned in a
// single scheduled run. Each item needs its own `findMany` (Drizzle/D1 has no
// "top-N-per-group" query), so an unbounded `overflowItems` list means an unbounded
// number of D1 round trips — the same class of failure documented at length in
// d1-export.ts's module comment and CLAUDE.md's D1 section (D1's paid-plan cap is
// 1,000 queries per Worker invocation). Retention pruning is inherently
// re-triggerable — any item left over this run is still overflowing and gets caught
// on the next scheduled run — so an exhaustive single pass isn't required.
const MAX_OVERFLOW_ITEMS_PER_RUN = 100

// Caps how many DELETE statements go into a single db.batch() call. Revision rows are
// far smaller than a full content/media row, but an unbounded batch is still the same
// shape of risk d1-export.ts's history (see CLAUDE.md) warns against for any D1-facing
// batch — chunking keeps each round trip small and bounded regardless of how many
// items overflowed this run.
const DELETE_BATCH_CHUNK_SIZE = 50

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

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
  // Find items that have more revisions than the retention limit — capped per run (see
  // MAX_OVERFLOW_ITEMS_PER_RUN above); any item beyond the cap is still overflowing and
  // gets caught on a later run.
  const overflowItems = await db
    .select({ itemId: contentRevisions.itemId, total: count() })
    .from(contentRevisions)
    .groupBy(contentRevisions.itemId)
    .having(sql`count(*) > ${revisionRetentionCount}`)
    .limit(MAX_OVERFLOW_ITEMS_PER_RUN)

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

  for (const batch of chunk(deleteStatements, DELETE_BATCH_CHUNK_SIZE)) {
    await db.batch(batch as [typeof deleteStatements[number], ...typeof deleteStatements])
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

  // security.new_sign_in rows are exempt from the read-cutoff: they double as the list of
  // devices a user has already signed in from (security-alerts.ts), and forgetting a
  // device after 30 days would re-alert on it every month.
  const notificationsWhere = or(
    and(isNotNull(notifications.readAt), lt(notifications.createdAt, notificationReadCutoff), ne(notifications.type, 'security.new_sign_in')),
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

  // --- Email send log --- same retention as audit logs.
  const [emailLogRow] = await db.select({ value: count() }).from(emailLog).where(lt(emailLog.createdAt, cutoffDate))
  const prunedEmailLog = emailLogRow?.value ?? 0
  if (prunedEmailLog > 0) {
    await db.delete(emailLog).where(lt(emailLog.createdAt, cutoffDate))
  }

  // --- Spam email --- 30 days in the Spam folder, then gone, R2 objects included.
  // Bounded per run like the revision pruning above; the remainder goes next run.
  const spamCutoff = notificationReadCutoff
  const spam = await db.query.emailMessages.findMany({
    where: and(eq(emailMessages.status, 'spam'), lt(emailMessages.createdAt, spamCutoff)),
    columns: { id: true, rawKey: true, attachments: true },
    limit: MAX_OVERFLOW_ITEMS_PER_RUN,
  })
  if (spam.length) {
    const bucket = (globalThis as { __env__?: { MEDIA_BUCKET?: R2Bucket } }).__env__?.MEDIA_BUCKET
    const keys = spam.flatMap(m => [m.rawKey, ...(m.attachments ?? []).map(a => a.key)]).filter((k): k is string => !!k)
    if (bucket && keys.length) {
      // R2's bulk delete takes up to 1000 keys per call.
      for (const part of chunk(keys, 1000)) await bucket.delete(part).catch(err => console.error('[prune] Spam R2 delete failed:', err))
    }
    for (const ids of chunk(spam.map(m => m.id), DELETE_BATCH_CHUNK_SIZE)) {
      await db.delete(emailMessages).where(inArray(emailMessages.id, ids))
    }
  }

  // --- Crawler activity counters --- the SEO page shows at most 90 days.
  const crawlerCutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const [crawlerRow] = await db.select({ value: count() }).from(crawlerHits).where(lt(crawlerHits.day, crawlerCutoff))
  const prunedCrawlerHits = crawlerRow?.value ?? 0
  if (prunedCrawlerHits > 0) {
    await db.delete(crawlerHits).where(lt(crawlerHits.day, crawlerCutoff))
  }

  // --- Expired sign-in state --- invitations nobody accepted, one-time sign-in codes that
  // were never exchanged (they live ~60s), and site sessions past their expiry. All are
  // already ignored once expired; this just stops them accumulating.
  const nowIso = new Date().toISOString()
  const [expiredInvites, expiredCodes, expiredSiteSessions] = await Promise.all([
    db.select({ value: count() }).from(siteInvitations).where(lt(siteInvitations.expiresAt, nowIso)),
    db.select({ value: count() }).from(siteAuthCodes).where(lt(siteAuthCodes.expiresAt, nowIso)),
    db.select({ value: count() }).from(siteSessions).where(lt(siteSessions.expiresAt, nowIso)),
  ])
  if (expiredInvites[0]?.value) await db.delete(siteInvitations).where(lt(siteInvitations.expiresAt, nowIso))
  if (expiredCodes[0]?.value) await db.delete(siteAuthCodes).where(lt(siteAuthCodes.expiresAt, nowIso))
  if (expiredSiteSessions[0]?.value) await db.delete(siteSessions).where(lt(siteSessions.expiresAt, nowIso))

  // --- AI generation jobs --- a job is driven one step at a time by the admin page (see
  // utils/site-generation.ts), so one whose tab was closed for good just stops. After a
  // week it's marked failed so the history doesn't show it as still running; finished
  // jobs go after 90 days. The drafts a job created are ordinary content and stay.
  const sqliteNow = (offsetDays: number) => new Date(Date.now() - offsetDays * 86_400_000).toISOString().replace('T', ' ').slice(0, 19)
  const abandoned = await db.update(aiGenerationJobs)
    .set({ status: 'failed', error: 'Abandoned before it finished — start a new generation.', lockedUntil: null })
    .where(and(inArray(aiGenerationJobs.status, ['planning', 'approved', 'generating']), lt(aiGenerationJobs.updatedAt, sqliteNow(7))))
    .returning({ id: aiGenerationJobs.id })
  const expiredJobs = await db.delete(aiGenerationJobs)
    .where(and(inArray(aiGenerationJobs.status, ['complete', 'failed']), lt(aiGenerationJobs.updatedAt, sqliteNow(90))))
    .returning({ id: aiGenerationJobs.id })

  return {
    prunedAuditLogs,
    prunedRevisions,
    prunedRateLimits,
    prunedNotifications,
    prunedEmailLog,
    prunedSpamEmail: spam.length,
    prunedCrawlerHits,
    abandonedAiJobs: abandoned.length,
    prunedAiJobs: expiredJobs.length,
    prunedInvitations: expiredInvites[0]?.value ?? 0,
    prunedSignInCodes: expiredCodes[0]?.value ?? 0,
    prunedSiteSessions: expiredSiteSessions[0]?.value ?? 0,
  }
}
