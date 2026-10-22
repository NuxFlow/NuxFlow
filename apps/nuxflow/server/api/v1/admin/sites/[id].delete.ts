import { eq } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireControlPlane } from '../../../../utils/control-plane'
import { deleteSiteCompletely } from '../../../../utils/site-deletion'
import { cancelHostingForDeletedSite } from '../../../../utils/hosting-billing'
import { sitePool } from '../../../../utils/pool-sites'
import { syncSiteDirectory } from '../../../../utils/site-directory'
import { POOL_PROTOCOL } from '../../../../utils/pool-admin'
import { callPool } from '../../../../utils/pools'

export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  const id = getRouterParam(event, 'id')!

  if (id === event.context.siteId) {
    throw conflict('Cannot delete the site you are currently viewing. Switch to another domain first.')
  }

  // A site in a member pool is deleted there, by the same code (utils/pool-sites.ts), and
  // its addresses stop routing to the pool.
  const [local] = await useDb(event).select({ id: sites.id }).from(sites).where(eq(sites.id, id)).limit(1)
  const pool = local ? null : await sitePool(event, id)
  // Its hosting subscription lives here, not in the pool: stop the billing first (refuses
  // if Stripe can't be reached), as deleteSiteCompletely() does for this Worker's own sites.
  if (pool) await cancelHostingForDeletedSite(event, id)
  const { failedMediaDeletes } = pool
    ? await callPool(pool.stub.deleteSite({ protocol: POOL_PROTOCOL, siteId: id, actorUserId: userId }), `pool ${pool.poolId}`)
    : await deleteSiteCompletely(event, id, userId)
  if (pool) await syncSiteDirectory(event)

  if (failedMediaDeletes.length > 0) {
    return { failedMediaDeletes }
  }
  return noContent(event)
})
