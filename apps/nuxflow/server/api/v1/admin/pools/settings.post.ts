import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { requireControlPlane } from '../../../../utils/control-plane'
import { pushSettingsToPools } from '../../../../utils/pools'
import { writeAuditLog } from '../../../../utils/audit'

/**
 * Super Admin → Pools → "Send platform settings": sends them to every pool now — after
 * connecting a new pool, or when one was unreachable at the last Platform save.
 */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  await requireHostingPlatform(event)

  const results = await pushSettingsToPools(event)
  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'pools',
    after: { platformSettingsSent: results.map(r => ({ pool: r.binding, ok: r.ok })) },
  })
  return { results }
})
