import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert } from '../../../../utils/audit'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await getDynamicPluginByIdOrThrow(db, siteId, id)

  const update = db.update(dynamicPlugins)
    .set({ isActive: true })
    .where(and(eq(dynamicPlugins.id, id), eq(dynamicPlugins.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'enable', resource: 'dynamic_plugin', resourceId: id })
  await db.batch(auditInsert ? [update, auditInsert] : [update])

  return { success: true }
})
