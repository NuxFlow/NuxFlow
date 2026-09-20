import { z } from 'zod'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { getStripeProvider, getLemonSqueezyProvider, getPaddleProvider } from '../../../utils/payments/resolve'
import { isHttpError, errorMessage } from '../../../utils/errors'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  returnUrl: z.url(),
})

export default defineEventHandler(async (event) => {
  // This makes a real API call to whichever payment provider is configured on every
  // request (session creation, or a subscription re-fetch for LS) — same cost profile as
  // checkout.post.ts, which rate-limits itself for the same reason.
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'membership-billing-portal' })
  const session = await requireSession(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const db = useDb(event)
  const userId = session.user.id as string

  const activeSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.siteId, siteId),
      eq(subscriptions.userId, userId),
      ne(subscriptions.status, 'cancelled'),
    ),
    columns: { provider: true, providerCustomerId: true, providerSubscriptionId: true },
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })

  if (!activeSub?.providerCustomerId) {
    throw notFound('No active subscription found')
  }

  // Free-tier rows (providerSubscriptionId starting `free_`) carry no real provider
  // customer/subscription to open a portal for — there's nothing to manage there.
  if (activeSub.providerSubscriptionId.startsWith('free_')) {
    throw notFound('No active subscription found')
  }

  try {
    if (activeSub.provider === 'stripe') {
      const stripe = await getStripeProvider(event)
      const portalSession = await stripe.createBillingPortalSession(activeSub.providerCustomerId, body.returnUrl)
      return { url: portalSession.url }
    }

    if (activeSub.provider === 'lemonsqueezy') {
      // LS bakes a pre-signed portal link directly onto the subscription resource rather
      // than exposing a separate "create session" endpoint — re-fetch it fresh since it's
      // only valid 24h from when it was issued (see the field's doc comment in
      // lemonsqueezy.ts), so a cached/stale one from install time can't be reused here.
      const ls = await getLemonSqueezyProvider(event)
      const sub = await ls.getSubscription(activeSub.providerSubscriptionId)
      const url = sub.attributes.urls?.customer_portal
      if (!url) throw createError({ statusCode: 502, message: 'Lemon Squeezy did not return a customer portal URL for this subscription' })
      return { url }
    }

    if (activeSub.provider === 'paddle') {
      const paddle = await getPaddleProvider(event)
      const result = await paddle.createPortalSession(activeSub.providerCustomerId, [activeSub.providerSubscriptionId])
      return { url: result.data.urls.general.overview }
    }
  } catch (err) {
    if (isHttpError(err)) throw err
    throw createError({ statusCode: 502, message: `Payment provider billing portal request failed: ${errorMessage(err)}` })
  }

  throw createError({ statusCode: 502, message: `Unsupported payment provider: ${activeSub.provider}` })
})
