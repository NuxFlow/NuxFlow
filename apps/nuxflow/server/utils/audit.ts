import { useDb } from './db'
import { auditLogs } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { H3Event } from 'h3'

interface AuditOptions {
  action: string
  resource: string
  resourceId?: string
  before?: unknown
  after?: unknown
}

export async function writeAuditLog(event: H3Event, userId: string, opts: AuditOptions) {
  const siteId = event.context.siteId
  if (!siteId) return

  const db = useDb(event)
  await db.insert(auditLogs).values({
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
