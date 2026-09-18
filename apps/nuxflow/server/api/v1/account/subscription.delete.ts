import { subscriptions } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { getConfiguredPaymentProvider } from '../../../utils/payments/resolve'
import { isHttpError, errorMessage } from '../../../utils/errors'
import { writeAuditLog } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
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
      if (isHttpError(err)) throw err
      throw createError({
        statusCode: 502,
        message: `Payment provider cancellation failed: ${errorMessage(err)}`,
      })
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
