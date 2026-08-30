import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { getConfiguredPaymentProvider } from '../../../utils/payments/resolve'
import { isHttpError, errorMessage } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const siteId = event.context.siteId as string
  const userId = session.user.id as string
  const db = useDb(event)

  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.siteId, siteId),
      eq(subscriptions.status, 'active'),
    ),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })

  if (!sub) {
    throw notFound('No active subscription found')
  }

  const isFree = sub.providerSubscriptionId.startsWith('free_')

  if (!isFree) {
    // Cancel with the payment provider before updating our DB. Each provider needs
    // different settings to construct, but once built they're interchangeable here —
    // all three implement PaymentProvider.cancelSubscription with the same shape.
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
  }

  await db.update(subscriptions)
    .set({ status: 'cancelled', cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(subscriptions.id, sub.id))

  return noContent(event)
})
