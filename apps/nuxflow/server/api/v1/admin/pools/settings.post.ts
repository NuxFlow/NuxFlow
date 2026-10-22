import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { requireControlPlane } from '../../../../utils/control-plane'
import { pushSettingsToPools } from '../../../../utils/pools'
import { pushPlansToPools } from '../../../../utils/pool-sites'
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
  // And the hosting plans, so a newly connected pool has everything its sites need.
  for (const result of results.filter(r => r.ok)) {
    try {
      await pushPlansToPools(event, [result.binding])
    } catch (err) {
      result.ok = false
      result.error = `Settings sent, but not the hosting plans: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'pools',
    after: { platformSettingsSent: results.map(r => ({ pool: r.binding, ok: r.ok })) },
  })
  return { results }
})
