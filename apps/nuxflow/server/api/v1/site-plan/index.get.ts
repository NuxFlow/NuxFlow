import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { sitePlanSummary } from '../../../utils/hosting-plans'
import { requireSiteId } from '../../../utils/site-context'

/**
 * This site's hosting plan and how much of each limit it's using — the dashboard's usage
 * card. `plan: null` (the built-in unlimited plan) means there's nothing to show.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  return sitePlanSummary(useDb(event), requireSiteId(event))
})
