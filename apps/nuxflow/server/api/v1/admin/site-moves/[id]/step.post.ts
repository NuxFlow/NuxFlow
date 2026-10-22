import { requireSuperAdmin } from '../../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../../utils/hosting-platform'
import { requireControlPlane } from '../../../../../utils/control-plane'
import { stepSiteMove } from '../../../../../utils/site-move-job'

/** Does the next piece of a move (site-move-job.ts); the page calls it until `more` is false. */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  await requireSuperAdmin(event)
  await requireHostingPlatform(event)
  return stepSiteMove(event, getRouterParam(event, 'id')!)
})
