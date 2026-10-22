import { requireSuperAdmin } from '../../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../../utils/hosting-platform'
import { requireControlPlane } from '../../../../../utils/control-plane'
import { cancelSiteMove } from '../../../../../utils/site-move-job'

/** Stops a move that hasn't switched yet: the new copy is removed and the site unlocked. */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  await requireHostingPlatform(event)
  return { move: await cancelSiteMove(event, getRouterParam(event, 'id')!, userId) }
})
