import { subscriptions, membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const siteId = event.context.siteId as string
  const userId = session.user.id as string
  const db = useDb(event)

  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.siteId, siteId),
    ),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })

  if (!sub) return { subscription: null, tier: null }

  const tier = sub.tierId
    ? await db.query.membershipTiers.findFirst({
        where: eq(membershipTiers.id, sub.tierId),
        columns: { id: true, name: true, price: true, currency: true, interval: true, features: true },
      })
    : null

  return {
    subscription: {
      id: sub.id,
      status: sub.status,
      provider: sub.provider,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelledAt: sub.cancelledAt,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      // Free-tier rows have no real provider or billing period behind them (see
      // checkout.post.ts's free-tier branch) — the frontend needs this to show accurate
      // cancellation copy ("ends immediately" vs. "keeps access until period end"),
      // since `provider` alone can't tell a free row apart from a real Stripe one.
      isFree: sub.providerSubscriptionId.startsWith('free_'),
    },
    tier,
  }
})
