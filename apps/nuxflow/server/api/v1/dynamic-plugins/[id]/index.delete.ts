import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { deletePluginAssets } from '../../../../utils/cf-plugin-kv'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { purgeEdgeCache } from '../../../../utils/edge-cache'

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

  // A deleted (or `plugin update`'s delete-then-reinstall) plugin's bundle route must
  // 404/serve fresh content on the very next request, not an edge-cached stale copy.
  // Also purge GET /api/public/site's `hasPlugins` flag — see enable.post.ts's comment
  // for why a stale `false` (the direction this delete could cause if it removed the
  // site's last active client plugin... or, for `plugin update`'s delete-then-reinstall,
  // a stale `true` briefly) matters more than the reverse.
  await purgeEdgeCache(event, [`/_nuxflow/plugin-bundle/${id}`, '/api/public/site'])

  return noContent(event)
})
