import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireControlPlane } from '../../../../utils/control-plane'
import { deleteSiteCompletely, deleteUnneededAccounts } from '../../../../utils/site-deletion'
import { cancelHostingForDeletedSite } from '../../../../utils/hosting-billing'
import { sitePool } from '../../../../utils/pool-sites'
import { syncSiteDirectory } from '../../../../utils/site-directory'
import { POOL_PROTOCOL } from '../../../../utils/pool-admin'
import { callPool } from '../../../../utils/pools'
import { removePoolSiteDomains } from '../../../../utils/hosting-domains'
import { assertSiteNotMoving } from '../../../../utils/site-move-job'
import { writeAuditLog } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  const id = getRouterParam(event, 'id')!

  if (id === event.context.siteId) {
    throw conflict('Cannot delete the site you are currently viewing. Switch to another domain first.')
  }

  await assertSiteNotMoving(useDb(event), id)

  const [local] = await useDb(event).select({ id: sites.id }).from(sites).where(eq(sites.id, id)).limit(1)
  if (local) return leftovers(event, await deleteSiteCompletely(event, id, userId))

  // A site in a member pool is deleted there, by the same code (utils/pool-sites.ts), and
  // its addresses stop routing to the pool.
  const pool = await sitePool(event, id)
  if (!pool) throw notFound('Site not found')
  // First the steps that can refuse (its members' paid subscriptions, a move), so a refusal
  // leaves everything as it was. Pools from before protocol 2 don't have this step.
  const { protocol } = await callPool(pool.stub.status(), `pool ${pool.poolId}`)
  if (protocol >= 2) {
    const prepared = await callPool(pool.stub.prepareSiteDeletion({ protocol: POOL_PROTOCOL, siteId: id }), `pool ${pool.poolId}`)
    if (!prepared.ok) httpError({ status: prepared.error.statusCode, message: prepared.error.message, data: prepared.error.data })
  }
  // Its hosting subscription lives here, not in the pool: stop the billing next (refuses
  // if Stripe can't be reached), as deleteSiteCompletely() does for this Worker's own sites.
  await cancelHostingForDeletedSite(event, id)
  // The pool can't reach Cloudflare, so the site's own domains are removed from it here.
  const leftoverDomains = await removePoolSiteDomains(event, pool.poolId, id)
  const result = await callPool(pool.stub.deleteSite({ protocol: POOL_PROTOCOL, siteId: id, actorUserId: userId }), `pool ${pool.poolId}`)
  await syncSiteDirectory(event)
  // The pool erased its copies of the site's people; their accounts are here, and go too
  // when nothing else needs them (as for this Worker's own sites).
  if (result.people) await deleteUnneededAccounts(event, id, result.people)
  // The pool can't write this: its audit log goes with the site.
  await writeAuditLog(event, userId, {
    action: 'delete',
    resource: 'site',
    resourceId: id,
    after: { poolId: pool.poolId, failedMediaDeletes: result.failedMediaDeletes, leftoverDomains },
  })
  return leftovers(event, { failedMediaDeletes: result.failedMediaDeletes, leftoverDomains })
})

/** 204 when everything went; otherwise what's left, for the operator to clear by hand. */
function leftovers(event: H3Event, result: { failedMediaDeletes: string[]; leftoverDomains: string[] }) {
  if (!result.failedMediaDeletes.length && !result.leftoverDomains.length) return noContent(event)
  return result
}
