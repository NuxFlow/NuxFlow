import type Stripe from 'stripe'
import { HOSTING_WEBHOOK_SECRET_KEY, hostingContext, isHostingStripeObject, syncHostingSubscription } from '../../../utils/hosting-billing'
import { getStripeProvider } from '../../../utils/payments/resolve'
import { resolveStringSetting } from '../../../utils/settings'
import { rateLimit } from '../../../utils/rate-limit'

/**
 * Stripe → the hosting platform. Every event is answered by re-reading the subscription
 * from Stripe (events arrive in any order, and redeliveries are common) and applying its
 * current state with syncHostingSubscription(). Events for anything other than a hosting
 * sign-up (e.g. a site's own memberships on the same Stripe account) are acknowledged and
 * ignored.
 */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  await rateLimit(event, { limit: 300, windowMs: 60_000, keyPrefix: 'hosting-webhook' })
  const secret = await resolveStringSetting(ctx.primaryEvent, HOSTING_WEBHOOK_SECRET_KEY)
  if (!secret) throw createError({ statusCode: 503, message: 'The hosting webhook signing secret is not set (Super Admin → Platform).' })
  const stripe = await getStripeProvider(ctx.primaryEvent)

  const rawBody = await readRawBody(event) ?? ''
  let stripeEvent: Stripe.Event
  try {
    stripeEvent = await stripe.constructWebhookEvent(rawBody, getHeader(event, 'stripe-signature') ?? '', secret as string)
  }
  catch {
    throw badRequest('Invalid Stripe webhook signature')
  }

  let subscriptionId: string | null = null
  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const session = stripeEvent.data.object
      if (isHostingStripeObject(session) && typeof session.subscription === 'string') subscriptionId = session.subscription
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.deleted': {
      const sub = stripeEvent.data.object
      if (isHostingStripeObject(sub)) subscriptionId = sub.id
      break
    }
  }
  if (!subscriptionId) return { received: true, ignored: true }

  let sub: Stripe.Subscription
  try {
    sub = await stripe.getSubscription(subscriptionId)
  }
  catch (err) {
    // Not a 2xx, so Stripe retries later instead of treating the event as delivered.
    throw createError({ statusCode: 502, message: `Failed to fetch Stripe subscription ${subscriptionId}: ${(err as Error).message}` })
  }
  const row = await syncHostingSubscription(ctx, sub)
  return { received: true, status: row?.status ?? null }
})
