import { useDb } from '../../utils/db'
import { requireRole } from '../../utils/permissions'
import { parsePagination } from '../../utils/pagination'
import { auditLogs } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
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

  return { logs, page, limit }
})
