import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireControlPlane } from '../../../../utils/control-plane'
import { assertDomainAvailable, siteChangesSchema, updateSiteRecord } from '../../../../utils/site-admin'
import { pushPlansToPools, sitePool } from '../../../../utils/pool-sites'
import { syncSiteDirectory } from '../../../../utils/site-directory'
import { POOL_PROTOCOL } from '../../../../utils/pool-admin'
import { callPool } from '../../../../utils/pools'
import { useDb } from '../../../../utils/db'
import { poolBindingName } from '../../../../../shared/lib/pool-id'

/**
 * Super Admin → Sites → Edit: name, domain, status, locale, hosting plan. Applied by
 * updateSiteRecord() (utils/site-admin.ts) in whichever database the site lives in — this
 * one, or its member pool's (utils/pool-sites.ts).
 */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  const id = getRouterParam(event, 'id')!
  const changes = await parseBody(event, siteChangesSchema)

  if (await updateSiteRecord(event, id, changes, userId)) return { id }

  const pool = await sitePool(event, id)
  if (!pool) throw notFound('Site not found')
  // Checked here too: only the control plane sees every pool's addresses and its own.
  if (changes.domain !== undefined) changes.domain = await assertDomainAvailable(useDb(event), changes.domain, id)
  // The plan must exist in the pool's copy before a site can be given it.
  if (changes.hostingPlanId) await pushPlansToPools(event, [poolBindingName(pool.poolId)])
  const { updated } = await callPool(pool.stub.updateSite({ protocol: POOL_PROTOCOL, siteId: id, changes, actorUserId: userId }), `pool ${pool.poolId}`)
  if (!updated) throw notFound('Site not found')
  // A new address must reach the pool through the router.
  if (changes.domain !== undefined) await syncSiteDirectory(event)
  return { id }
})
