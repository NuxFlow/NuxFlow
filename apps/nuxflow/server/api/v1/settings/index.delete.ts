import { requireRole } from '../../../utils/permissions'
import { deleteSiteCompletely } from '../../../utils/site-deletion'
import { useDb } from '../../../utils/db'
import { requireSiteId } from '../../../utils/site-context'
import { isMemberPool } from '../../../utils/control-plane'
import { assertSiteNotMoving } from '../../../utils/site-move-job'
import { forbidden } from '../../../utils/response'

export default defineEventHandler(async (event) => {
  // A pool site's hosting subscription, Cloudflare domains and routing entry all live on the
  // control plane, which this pool can't change — deleting here would keep billing the
  // customer. Super Admin → Sites on the control plane deletes it with all of that.
  if (isMemberPool()) forbidden('Delete this site from Super Admin → Sites on the platform\'s control panel, which also cancels its hosting subscription and removes its domains.')
  const { userId } = await requireRole(event, 'super_admin')
  const siteId = requireSiteId(event)
  const db = useDb(event)
  await assertSiteNotMoving(db, siteId)

  const siteCount = (await db.query.sites.findMany({ columns: { id: true } })).length

  // Always a full delete. deleteSiteCompletely() refuses (409, listing the blocking sites)
  // when this is the primary site and other sites still exist; any other site can go
  // regardless. Re-provisioning a domain afterward goes through Super Admin → Sites → New.
  const { failedMediaDeletes } = await deleteSiteCompletely(event, siteId, userId)
  return { id: siteId, wasLastSite: siteCount === 1, failedMediaDeletes }
})
