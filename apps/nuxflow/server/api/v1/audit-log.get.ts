import { useDb } from '../../utils/db'
import { requireRole } from '../../utils/permissions'
import { parsePagination } from '../../utils/pagination'
import { auditLogs } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'
import { requireSiteId } from '../../utils/site-context'
import type { AuditLogEntry } from '../../../shared/lib/site-admin-types'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const { page, limit, offset } = parsePagination(getQuery(event), 200)

  // No COUNT(*) here (unlike content/index.get.ts) — the audit log has no natural
  // upper bound and grows forever, so counting the whole table on every page load
  // would only get more expensive over the site's lifetime for no real benefit. The
  // client instead infers "more pages exist" from getting a full page back, same as
  // admin/content/index.vue's own load-more pattern.
  const logs = await db.query.auditLogs.findMany({
    where: eq(auditLogs.siteId, siteId),
    orderBy: [desc(auditLogs.createdAt)],
    limit,
    offset,
  })

  // Only what the page shows — before/after snapshots can be whole pages of content.
  const entries: AuditLogEntry[] = logs.map(l => ({
    id: l.id,
    action: l.action,
    resource: l.resource,
    resourceId: l.resourceId,
    userId: l.userId,
    createdAt: l.createdAt,
    aiAssist: readAiAssist(l.after),
  }))
  return { logs: entries, page, limit }
})

function readAiAssist(after: unknown): AuditLogEntry['aiAssist'] {
  const a = after && typeof after === 'object' ? (after as { aiAssist?: unknown }).aiAssist : null
  if (!a || typeof a !== 'object') return null
  const { kind, instruction, summary } = a as Record<string, unknown>
  return { kind: String(kind ?? ''), instruction: String(instruction ?? ''), summary: String(summary ?? '') }
}
