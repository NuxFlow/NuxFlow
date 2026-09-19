import { requireSuperAdmin } from '../../../utils/permissions'
import { getD1SizeStats, D1_PAID_PLAN_SIZE_CAP_BYTES } from '../../../utils/d1-stats'

// Whole-instance size visibility — same requireSuperAdmin gate as db-export.get.ts,
// since this reports every site's data, not just the caller's current one. See
// server/utils/d1-stats.ts for what's measured and why.
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)

  let stats
  try {
    stats = await getD1SizeStats(event)
  } catch (err) {
    // See d1-stats.ts's module comment: a full-table scan on a large database risks
    // D1's 30s query-duration cap, and this codebase's own history is entirely
    // undocumented-D1-behavior surprises only diagnosable from a labeled server log —
    // logged here (labeledD1Query() already names which table's scan failed) rather
    // than left as a bare unhandled rejection.
    console.error('[db-stats] getD1SizeStats failed:', err)
    throw createError({ statusCode: 500, message: 'Failed to compute database size stats — see server logs for which query failed.' })
  }

  return { ...stats, paidPlanSizeCapBytes: D1_PAID_PLAN_SIZE_CAP_BYTES }
})
