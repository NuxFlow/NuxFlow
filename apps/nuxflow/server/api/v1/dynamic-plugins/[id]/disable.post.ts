import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { purgeEdgeCache } from '../../../../utils/edge-cache'

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

  // A disabled plugin's bundle route (_nuxflow/plugin-bundle/[id].ts) must 404 on the
  // very next request, not keep serving an edge-cached copy for up to its 1h TTL.
  // Also purge GET /api/public/site: its cached `hasPlugins` flag reflects active+client
  // plugins, so disabling the site's last one must not leave a stale `true` behind (that
  // would only cost a redundant, harmless client fetch — but a stale `false` after
  // *enabling* is the direction that actually breaks something, see enable.post.ts).
  await purgeEdgeCache(event, [`/_nuxflow/plugin-bundle/${id}`, '/api/public/site'])

  return { success: true }
})
