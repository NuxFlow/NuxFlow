import { useDb } from './db'
import type { Db } from './db'
import { auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { H3Event } from 'h3'
import type { BatchItem } from 'drizzle-orm/batch'

interface AuditOptions {
  action: string
  resource: string
  resourceId?: string
  before?: unknown
  after?: unknown
}

// Returns the unexecuted insert query so callers can fold it into a db.batch()
// alongside the primary write, instead of paying a separate D1 round trip for
// the audit row. Returns null when there's no site in context (nothing to batch).
export function buildAuditLogInsert(event: H3Event, userId: string, opts: AuditOptions) {
  const siteId = event.context.siteId
  if (!siteId) return null

  const db = useDb(event)
  return db.insert(auditLogs).values({
    id: ulid(),
    siteId,
    userId,
    action: opts.action,
    resource: opts.resource,
    resourceId: opts.resourceId,
    before: opts.before,
    after: opts.after,
    ipAddress: getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })
}

export async function writeAuditLog(event: H3Event, userId: string, opts: AuditOptions) {
  const insert = buildAuditLogInsert(event, userId, opts)
  if (insert) await insert
}

// Folds the audit-log insert (possibly null, when there's no site in context) into the
// same db.batch() as the primary write(s) instead of every mutation route repeating the
// `auditInsert ? [...writes, auditInsert] : writes` ternary by hand.
export async function batchWithAudit(
  db: Db,
  writes: readonly [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]],
  auditInsert: ReturnType<typeof buildAuditLogInsert>,
): Promise<void> {
  await db.batch(auditInsert ? [...writes, auditInsert] : writes)
}
