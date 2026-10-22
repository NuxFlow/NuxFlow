import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { requireControlPlane } from '../../../../utils/control-plane'
import { syncSiteDirectory } from '../../../../utils/site-directory'
import { writeAuditLog } from '../../../../utils/audit'

/**
 * Super Admin → Pools → "Update routing": rebuilds the site directory the front-door
 * router uses (utils/site-directory.ts) now, rather than at the next hourly sync.
 */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  await requireHostingPlatform(event)

  const result = await syncSiteDirectory(event)
  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'pools',
    after: { directory: { routed: result.routed, added: result.added, removed: result.removed, conflicts: result.conflicts.length } },
  })
  return result
})
