import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { deletePluginAssets } from '../../../../utils/cf-env'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getDynamicPluginByIdOrThrow(db, siteId, id)

  await deletePluginAssets(event, siteId, id)
  const pluginDelete = db.delete(dynamicPlugins).where(scopedById(dynamicPlugins.id, id, dynamicPlugins.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete', resource: 'dynamic_plugin', resourceId: id, before: existing,
  })
  await batchWithAudit(db, [pluginDelete], auditInsert)

  return noContent(event)
})
