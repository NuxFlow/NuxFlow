import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { apiKeys } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, id), eq(apiKeys.siteId, siteId)),
    columns: { id: true, name: true, scopes: true },
  })

  const keyDelete = db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'api_key',
    resourceId: id,
    before: existing,
  })

  await db.batch(auditInsert ? [keyDelete, auditInsert] : [keyDelete])

  return { success: true }
})
