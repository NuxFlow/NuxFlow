import { eq, sql } from 'drizzle-orm'
import { hostingPlans, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { noContent, notFound } from '../../../../utils/response'
import { clearHostingPlanCache } from '../../../../utils/hosting-plans'

/**
 * Deletes a plan. Its sites go back to the built-in unlimited plan — done here because
 * `sites.hosting_plan_id` has no database-level foreign key (see the comment on `sites`).
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  const existing = await db.query.hostingPlans.findFirst({ where: eq(hostingPlans.id, id) })
  if (!existing) throw notFound('Plan not found')

  await db.batch([
    db.update(sites).set({ hostingPlanId: null, updatedAt: sql`(datetime('now'))` }).where(eq(sites.hostingPlanId, id)),
    db.delete(hostingPlans).where(eq(hostingPlans.id, id)),
  ])
  clearHostingPlanCache()
  await writeAuditLog(event, userId, { action: 'delete', resource: 'hosting_plan', resourceId: id, before: existing })
  return noContent(event)
})
