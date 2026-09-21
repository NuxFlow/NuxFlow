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
    .set({ isActive: true })
    .where(scopedById(dynamicPlugins.id, id, dynamicPlugins.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'enable', resource: 'dynamic_plugin', resourceId: id })
  await batchWithAudit(db, [update], auditInsert)

  // GET /api/public/site's cached `hasPlugins` flag may now be a stale `false` if this
  // was the site's first active client plugin — dynamic-plugins.client.ts uses that flag
  // to decide whether to fetch plugin blocks at all, so a stale `false` would silently
  // keep this plugin's blocks from ever registering client-side until the cache expires.
  await purgeEdgeCache(event, ['/api/public/site'])

  return { success: true }
})
