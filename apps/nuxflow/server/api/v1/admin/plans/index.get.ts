import { asc, count, isNotNull } from 'drizzle-orm'
import { hostingPlans, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'

/** Every hosting plan, with how many sites are on each. */
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)
  const [plans, counts] = await Promise.all([
    db.select().from(hostingPlans).orderBy(asc(hostingPlans.sortOrder), asc(hostingPlans.name)),
    db.select({ planId: sites.hostingPlanId, n: count() }).from(sites).where(isNotNull(sites.hostingPlanId)).groupBy(sites.hostingPlanId),
  ])
  const sitesByPlan = new Map(counts.map(c => [c.planId, c.n]))
  return { plans: plans.map(p => ({ ...p, siteCount: sitesByPlan.get(p.id) ?? 0 })) }
})
