import { subscriptions, users, membershipTiers } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)

  const page = Math.max(1, Number(query.page ?? 1))
  const perPage = 50

  const rows = await db
    .select({
      id: subscriptions.id,
      provider: subscriptions.provider,
      providerSubscriptionId: subscriptions.providerSubscriptionId,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelledAt: subscriptions.cancelledAt,
      createdAt: subscriptions.createdAt,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      tierId: membershipTiers.id,
      tierName: membershipTiers.name,
    })
    .from(subscriptions)
    .leftJoin(users, eq(subscriptions.userId, users.id))
    .leftJoin(membershipTiers, eq(subscriptions.tierId, membershipTiers.id))
    .where(eq(subscriptions.siteId, siteId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage)

  return { subscribers: rows, page, perPage }
})
