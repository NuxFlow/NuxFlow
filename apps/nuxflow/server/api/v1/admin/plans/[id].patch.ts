import { eq, sql } from 'drizzle-orm'
import { hostingPlans } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { writeAuditLog } from '../../../../utils/audit'
import { notFound } from '../../../../utils/response'
import { planBodySchema } from '../../../../utils/hosting-plan-schema'
import { clearHostingPlanCache } from '../../../../utils/hosting-plans'
import { syncPlanToStripe } from '../../../../utils/hosting-billing'

/** Changes take effect within a minute on every isolate (the plan cache's lifetime). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  await requireHostingPlatform(event)
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, planBodySchema.partial())
  const db = useDb(event)

  const existing = await db.query.hostingPlans.findFirst({ where: eq(hostingPlans.id, id) })
  if (!existing) throw notFound('Plan not found')

  const stripeIds = await syncPlanToStripe(event, existing, { ...existing, ...body })
  const [plan] = await db.update(hostingPlans)
    .set({ ...body, ...stripeIds, updatedAt: sql`(datetime('now'))` })
    .where(eq(hostingPlans.id, id))
    .returning()
  clearHostingPlanCache()
  await writeAuditLog(event, userId, { action: 'update', resource: 'hosting_plan', resourceId: id, before: existing, after: body })
  return plan
})
