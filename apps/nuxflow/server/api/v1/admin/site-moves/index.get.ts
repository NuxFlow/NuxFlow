import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { requireControlPlane } from '../../../../utils/control-plane'
import { useDb } from '../../../../utils/db'
import { listSiteMoves } from '../../../../utils/site-move-job'

/** Recent site moves between pools, newest first (Super Admin → Sites). */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  await requireSuperAdmin(event)
  await requireHostingPlatform(event)
  return { moves: await listSiteMoves(useDb(event)) }
})
