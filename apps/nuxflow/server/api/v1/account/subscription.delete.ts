import { subscriptions } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { getConfiguredPaymentProvider } from '../../../utils/payments/resolve'
import { rethrowAsProviderError } from '../../../utils/errors'
import { writeAuditLog } from '../../../utils/audit'
import { rateLimit } from '../../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  // Calls out to the payment provider's cancellation API for non-free subscriptions —
  // same cost profile as checkout.post.ts/billing-portal.post.ts, which rate-limit
  // themselves for the same reason.
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'membership-cancel' })
  const session = await requireSession(event)
  const siteId = event.context.siteId as string
  const userId = session.user.id as string
  const db = useDb(event)

  // 'trialing' must be cancellable too — the account page already renders a Cancel button
  // for it (canCancel includes 'trialing'), and a trial-period subscription is a real,
  // provider-tracked subscription that needs the same cancel call, not just 'active' ones.
  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.siteId, siteId),
      inArray(subscriptions.status, ['active', 'trialing']),
    ),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })

  if (!sub) {
    throw notFound('No active subscription found')
  }

  const isFree = sub.providerSubscriptionId.startsWith('free_')

  if (isFree) {
    // No real provider or billing period behind a free-tier row — nothing to defer to,
    // so this is a genuine immediate cancellation.
    await db.update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(subscriptions.id, sub.id))
  } else {
    // Cancel with the payment provider before updating our DB. Each provider needs
    // different settings to construct, but once built they're interchangeable here —
    // all three implement PaymentProvider.cancelSubscription with the same shape, and all
    // three now defer to end-of-period rather than cancelling immediately (see stripe.ts's
    // cancelSubscription — Paddle/LemonSqueezy already deferred on their own).
    try {
      const provider = await getConfiguredPaymentProvider(event, sub.provider)
      await provider.cancelSubscription(sub.providerSubscriptionId)
    } catch (err) {
      rethrowAsProviderError(err, 'cancellation')
    }

    // `status` deliberately stays as-is (active/trialing) — access continues through the
    // period already paid for. The provider's own end-of-period webhook
    // (customer.subscription.deleted / subscription_expired / subscription.canceled) is
    // what finally flips status to 'cancelled', via cancelSubscriptionFromWebhook.
    await db.update(subscriptions)
      .set({ cancelAtPeriodEnd: true, cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(subscriptions.id, sub.id))
  }

  await writeAuditLog(event, userId, {
    action: 'cancel',
    resource: 'subscription',
    resourceId: sub.id,
    before: { status: sub.status, cancelAtPeriodEnd: sub.cancelAtPeriodEnd },
    after: isFree ? { status: 'cancelled' } : { cancelAtPeriodEnd: true },
  })

  return noContent(event)
})
