import { z } from 'zod'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { requireControlPlane } from '../../../../utils/control-plane'
import { startSiteMove } from '../../../../utils/site-move-job'
import { POOL_ID_RE } from '../../../../../shared/lib/pool-id'

const bodySchema = z.object({
  siteId: z.string().min(1).max(64),
  /** null = the control panel itself. */
  toPool: z.string().regex(POOL_ID_RE).nullable(),
})

/** Starts moving a site to another pool: locks it, then the page drives the steps. */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  await requireHostingPlatform(event)
  const body = await parseBody(event, bodySchema)
  return { move: await startSiteMove(event, body, userId) }
})
