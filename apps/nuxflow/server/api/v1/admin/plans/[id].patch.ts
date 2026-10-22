import { eq, sql } from 'drizzle-orm'
import { hostingPlans, sites } from '@nuxflow/db/schema'
import { PLAN_FEATURES } from '../../../../../shared/lib/hosting-plan-limits'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { requireControlPlane } from '../../../../utils/control-plane'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { writeAuditLog } from '../../../../utils/audit'
import { notFound } from '../../../../utils/response'
import { planBodySchema } from '../../../../utils/hosting-plan-schema'
import { clearHostingPlanCache, refreshSitesAfterPlanChange } from '../../../../utils/hosting-plans'
import { syncPlanToStripe } from '../../../../utils/hosting-billing'

/** Changes take effect within a minute on every isolate (the plan cache's lifetime). */
export default defineEventHandler(async (event) => {
  requireControlPlane(event)
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
  // A yes/no feature is baked into the sites' cached public JSON — clear theirs.
  if (PLAN_FEATURES.some(f => body[f.column] !== undefined && body[f.column] !== existing[f.column])) {
    const onPlan = await db.select({ id: sites.id }).from(sites).where(eq(sites.hostingPlanId, id))
    await refreshSitesAfterPlanChange(event, onPlan.map(s => s.id))
  }
  await writeAuditLog(event, userId, { action: 'update', resource: 'hosting_plan', resourceId: id, before: existing, after: body })
  return plan
})
