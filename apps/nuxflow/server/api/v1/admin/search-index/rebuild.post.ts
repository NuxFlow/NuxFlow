import { requireSuperAdmin } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { writeAuditLog } from '../../../../utils/audit'
import { restartSearchIndexRebuild, searchIndexStatus } from '../../../../utils/search-index-rebuild'

/**
 * Starts the smart-search rebuild over. Normally unnecessary — it runs by itself when the
 * index changes — but useful after recreating an index of the same size. The work is done
 * by the every-minute search-index-rebuild task, not here.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const state = await restartSearchIndexRebuild(event)
  if (!state) throw httpError({ status: 503, message: 'Smart search isn\'t set up on this deployment (no Vectorize index, or one of an unsupported size).' })
  await writeAuditLog(event, userId, { action: 'update', resource: 'search_index', resourceId: 'rebuild', after: { model: state.model } })
  return searchIndexStatus(event, useDb(event))
})
