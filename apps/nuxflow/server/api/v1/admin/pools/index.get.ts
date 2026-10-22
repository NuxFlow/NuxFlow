import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { requireControlPlane } from '../../../../utils/control-plane'
import { controlPlaneSummary, describePools, releaseSortKey } from '../../../../utils/pools'
import { directoryCounts } from '../../../../utils/site-directory'

/** Super Admin → Pools: this control plane and every member pool bound to it (utils/pools.ts). */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  await requireSuperAdmin(event)
  await requireHostingPlatform(event)

  const [controlPlane, pools, routed] = await Promise.all([controlPlaneSummary(useDb(event)), describePools(event), directoryCounts(event)])
  // The newest release anything here runs, so the page can show who hasn't got it yet.
  const releases = [controlPlane.release, ...pools.map(p => p.status?.release ?? null)].filter((r): r is string => !!r)
  const newestRelease = releases.sort((a, b) => releaseSortKey(b).localeCompare(releaseSortKey(a)))[0] ?? null
  // Addresses the router sends to each pool, by pool id (site-directory.ts).
  return { controlPlane, pools, newestRelease, routed }
})
