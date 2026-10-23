import { requireSuperAdmin } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { searchIndexStatus } from '../../../../utils/search-index-rebuild'

// Super Admin → Database's "Smart search index" card: the Vectorize index is shared by
// every site in this Worker, so it's a platform view, like db-stats.get.ts.
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  return searchIndexStatus(event, useDb(event))
})
