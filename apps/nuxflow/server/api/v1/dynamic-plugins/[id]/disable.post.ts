import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await getDynamicPluginByIdOrThrow(db, siteId, id)

  const update = db.update(dynamicPlugins)
    .set({ isActive: false })
    .where(scopedById(dynamicPlugins.id, id, dynamicPlugins.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'disable', resource: 'dynamic_plugin', resourceId: id })
  await batchWithAudit(db, [update], auditInsert)

  return { success: true }
})
