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
//
// `userId` accepts `null` for system/automated mutations with no acting user (e.g. a
// payment provider's webhook changing subscription state) — `auditLogs.userId` is a
// nullable FK (`onDelete: 'set null'`), so `null` is the honest attribution rather than
// a fabricated sentinel user.
export function buildAuditLogInsert(event: H3Event, userId: string | null, opts: AuditOptions) {
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

export async function writeAuditLog(event: H3Event, userId: string | null, opts: AuditOptions) {
  const insert = buildAuditLogInsert(event, userId, opts)
  if (insert) await insert
}

// Folds the audit-log insert (possibly null, when there's no site in context) into the
// same db.batch() as the primary write(s) instead of every mutation route repeating the
// `auditInsert ? [...writes, auditInsert] : writes` ternary by hand.
//
// `writes` is a plain readonly array (not a non-empty tuple) so callers can build it from
// a variable-length source — e.g. a registry-driven redaction batch (see
// @nuxflow/db/queries's buildGdprRedactionStatements()) spread alongside a fixed
// statement — without fighting TypeScript's tuple inference over a spread. The emptiness
// guarantee moves to a runtime check instead: `db.batch([])` is always a caller bug (there
// would be nothing to batch), never a legitimate call, so it fails loudly here rather than
// silently doing nothing.
export async function batchWithAudit(
  db: Db,
  writes: readonly BatchItem<'sqlite'>[],
  auditInsert: ReturnType<typeof buildAuditLogInsert>,
): Promise<void> {
  if (writes.length === 0) throw new Error('batchWithAudit: writes must not be empty')
  const all = (auditInsert ? [...writes, auditInsert] : writes) as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]
  await db.batch(all)
}
