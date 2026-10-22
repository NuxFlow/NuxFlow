import { requireSuperAdmin } from '../../../../utils/permissions'
import { describePools } from '../../../../utils/pools'
import { listAllSites } from '../../../../utils/pool-sites'

/**
 * Super Admin → Sites: this Worker's sites, plus every member pool's (utils/pool-sites.ts),
 * and the pools a new site can be created in.
 */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const [{ sites, unreachablePools }, pools] = await Promise.all([listAllSites(event), describePools(event)])
  return {
    sites,
    unreachablePools,
    pools: pools.filter(p => !p.error && p.status?.poolId).map(p => p.status!.poolId!),
  }
})
