import { useDb } from '../../../../utils/db'
import { requireRoleOrApiKey } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { deletePluginAssets } from '../../../../utils/cf-plugin-kv'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { dynamicPlugins, pluginStorage } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { scopedById } from '../../../../utils/db-helpers'
import { purgeEdgeCache } from '../../../../utils/edge-cache'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRoleOrApiKey(event, 'admin', 'manage:plugins')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getDynamicPluginByIdOrThrow(db, siteId, id)

  await deletePluginAssets(event, siteId, id)
  const pluginDelete = db.delete(dynamicPlugins).where(scopedById(dynamicPlugins.id, id, dynamicPlugins.siteId, siteId))
  // Uninstalling removes the plugin's stored data with it (a later reinstall starts empty).
  const storageDelete = db.delete(pluginStorage).where(and(eq(pluginStorage.siteId, siteId), eq(pluginStorage.pluginId, id)))

  const { settingsValues: _secrets, ...auditBefore } = existing
  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete', resource: 'dynamic_plugin', resourceId: id, before: auditBefore,
  })
  await batchWithAudit(db, [pluginDelete, storageDelete], auditInsert)

  // A deleted plugin's bundle route must 404 on the very next request, not serve an
  // edge-cached copy; its blocks must leave the public plugin list; and GET
  // /api/public/site's `hasPlugins` flag must not stay a stale `true` (see enable.post.ts).
  await purgeEdgeCache(event, [`/_nuxflow/plugin-bundle/${id}`, '/api/public/dynamic-plugins', '/api/public/site'])

  return noContent(event)
})
