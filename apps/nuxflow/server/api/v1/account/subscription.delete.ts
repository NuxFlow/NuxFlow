import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { resolveSetting } from '../../../utils/settings'
import { StripeProvider } from '../../../utils/payments/stripe'
import { LemonSqueezyProvider } from '../../../utils/payments/lemonsqueezy'
import { PaddleProvider } from '../../../utils/payments/paddle'

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
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
    throw createError({ statusCode: 404, message: 'No active subscription found' })
  }

  const isFree = sub.providerSubscriptionId.startsWith('free_')

  if (!isFree) {
    // Cancel with the payment provider before updating our DB
    try {
      if (sub.provider === 'stripe') {
        const stripeKey = await resolveSetting(event, 'payments.stripe_secret_key', 'stripeSecretKey')
        if (!stripeKey) throw createError({ statusCode: 503, message: 'Stripe is not configured' })
        const stripe = new StripeProvider(stripeKey)
        await stripe.cancelSubscription(sub.providerSubscriptionId)
      } else if (sub.provider === 'lemonsqueezy') {
        const lsApiKey = await resolveSetting(event, 'payments.ls_api_key', 'lsApiKey')
        const lsStoreId = await resolveSetting(event, 'payments.ls_store_id', 'lsStoreId')
        if (!lsApiKey || !lsStoreId) throw createError({ statusCode: 503, message: 'Lemon Squeezy is not configured' })
        const ls = new LemonSqueezyProvider(lsApiKey, lsStoreId)
        await ls.cancelSubscription(sub.providerSubscriptionId)
      } else if (sub.provider === 'paddle') {
        const paddleApiKey = await resolveSetting(event, 'payments.paddle_api_key', 'paddleApiKey')
        const paddleVendorId = await resolveSetting(event, 'payments.paddle_vendor_id', 'paddleVendorId')
        if (!paddleApiKey || !paddleVendorId) throw createError({ statusCode: 503, message: 'Paddle is not configured' })
        const paddle = new PaddleProvider(paddleApiKey, paddleVendorId)
        await paddle.cancelSubscription(sub.providerSubscriptionId)
      }
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode) throw err
      throw createError({
        statusCode: 502,
        message: `Payment provider cancellation failed: ${(err as Error).message}`,
      })
    }
  }

  await db.update(subscriptions)
    .set({ status: 'cancelled', cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(subscriptions.id, sub.id))

  return { cancelled: true }
})
