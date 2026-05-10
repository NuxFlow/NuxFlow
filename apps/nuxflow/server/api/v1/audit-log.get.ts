import { useDb } from '../../utils/db'
import { requireRole } from '../../utils/permissions'
import { auditLogs } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const logs = await db.query.auditLogs.findMany({
    where: eq(auditLogs.siteId, siteId),
    orderBy: [desc(auditLogs.createdAt)],
    limit: 200,
  })

  return { logs }
})
