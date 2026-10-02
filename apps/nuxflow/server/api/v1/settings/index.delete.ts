import { requireRole } from '../../../utils/permissions'
import { deleteSiteCompletely } from '../../../utils/site-deletion'
import { useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'super_admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const siteCount = (await db.query.sites.findMany({ columns: { id: true } })).length

  // Always a full delete. deleteSiteCompletely() refuses (409, listing the blocking sites)
  // when this is the primary site and other sites still exist; any other site can go
  // regardless. Re-provisioning a domain afterward goes through Super Admin → Sites → New.
  const { failedMediaDeletes } = await deleteSiteCompletely(event, siteId, userId)
  return { id: siteId, wasLastSite: siteCount === 1, failedMediaDeletes }
})
