import { ulid } from 'ulid'
import { hostingPlans } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { pushPlansToPools } from '../../../../utils/pool-sites'
import { waitUntil } from '../../../../utils/cf-env'
import { requireControlPlane } from '../../../../utils/control-plane'
import { requireHostingPlatform } from '../../../../utils/hosting-platform'
import { writeAuditLog } from '../../../../utils/audit'
import { created } from '../../../../utils/response'
import { planBodySchema } from '../../../../utils/hosting-plan-schema'
import { syncPlanToStripe } from '../../../../utils/hosting-billing'

export default defineEventHandler(async (event) => {
  requireControlPlane(event)
  const { userId } = await requireSuperAdmin(event)
  await requireHostingPlatform(event)
  const body = await parseBody(event, planBodySchema)
  const db = useDb(event)
  const id = ulid()
  // Stripe first: a plan with a price that couldn't be created there isn't saved at all.
  const stripeIds = await syncPlanToStripe(event, null, {
    name: body.name,
    description: body.description ?? '',
    priceMonthly: body.priceMonthly ?? null,
    priceYearly: body.priceYearly ?? null,
    currency: body.currency ?? 'gbp',
    stripeProductId: null,
    stripePriceMonthlyId: null,
    stripePriceYearlyId: null,
  })
  const [plan] = await db.insert(hostingPlans).values({ id, ...body, ...stripeIds }).returning()
  await writeAuditLog(event, userId, { action: 'create', resource: 'hosting_plan', resourceId: id, after: body })
  // Member pools keep a copy of the plans their sites' limits come from (utils/pool-sites.ts).
  waitUntil(event, pushPlansToPools(event).catch(err => console.error('[plans] Sending plans to pools failed:', err)))
  return created(event, plan)
})
