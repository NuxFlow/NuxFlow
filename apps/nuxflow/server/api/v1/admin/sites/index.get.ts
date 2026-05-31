import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)
  const allSites = await db.query.sites.findMany()
  return { sites: allSites }
})
