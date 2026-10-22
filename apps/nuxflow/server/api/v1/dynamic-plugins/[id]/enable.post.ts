import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { parseCapabilitiesText } from '../../../../utils/plugin-package'
import { samePermissions } from '../../../../../shared/lib/plugin-permissions'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { purgeEdgeCache } from '../../../../utils/edge-cache'
import { requireSiteId } from '../../../../utils/site-context'

const bodySchema = z.object({
  // The exact permissions the admin was shown and approved. Must equal what the plugin
  // asks for — a request built against an older version's permission list (or with none)
  // is refused, so approval is always of the plugin as it is now.
  approvedPermissions: z.array(z.string()).max(200).optional(),
}).optional()

// Enabling is where an admin approves a plugin's permissions. Only a person can do it
// (session, not an API key — `nuxflow plugin deploy` installs but never enables), and the
// grant is recorded, so the runtime hands the plugin exactly what was approved.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const plugin = await getDynamicPluginByIdOrThrow(db, siteId, id)
  const requested = parseCapabilitiesText(plugin.capabilities).permissions
  const approved = [...new Set(body?.approvedPermissions ?? [])].sort()
  if (!samePermissions(requested, approved)) {
    throw createError({
      statusCode: 409,
      message: 'Review this plugin’s permissions before enabling it — the approved list must match what the plugin asks for.',
      data: { code: 'permissions_mismatch', requested },
    })
  }

  const update = db.update(dynamicPlugins)
    .set({ isActive: true, grantedPermissions: requested })
    .where(scopedById(dynamicPlugins.id, id, dynamicPlugins.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'enable', resource: 'dynamic_plugin', resourceId: id, after: { grantedPermissions: requested } })
  await batchWithAudit(db, [update], auditInsert)

  // GET /api/public/site's cached `hasPlugins` flag may now be a stale `false` if this
  // was the site's first active client plugin — dynamic-plugins.client.ts uses that flag
  // to decide whether to fetch plugin blocks at all, so a stale `false` would silently
  // keep this plugin's blocks from ever registering client-side until the cache expires.
  await purgeEdgeCache(event, ['/api/public/site'])

  return { success: true, grantedPermissions: requested }
})
