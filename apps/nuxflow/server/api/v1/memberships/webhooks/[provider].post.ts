/* eslint-disable no-console */
import type { H3Event } from 'h3'
import type { StripeProvider } from '../../../../utils/payments/stripe'
import { getStripeProvider, getLemonSqueezyProvider, getPaddleProvider } from '../../../../utils/payments/resolve'
import { upsertSubscriptionFromWebhook, cancelSubscriptionFromWebhook, assertWebhookSiteMatch } from '../../../../utils/payments/webhook-sync'
import { resolveSetting } from '../../../../utils/settings'
import { rateLimit } from '../../../../utils/rate-limit'

const STATUS_MAP_ACTIVE_TRIAL_PASTDUE_UNPAID = {
  active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'unpaid',
} as const

// ── Stripe ───────────────────────────────────────────────────────────────────

async function handleStripeWebhook(event: H3Event, rawBody: string) {
  const stripe = await getStripeProvider(event)
  const stripeWebhookSecret = await resolveSetting(event, 'payments.stripe_webhook_secret', 'stripeWebhookSecret')
  const sig = getHeader(event, 'stripe-signature') ?? ''

  let stripeEvent: Awaited<ReturnType<StripeProvider['constructWebhookEvent']>>
  try {
    stripeEvent = await stripe.constructWebhookEvent(rawBody, sig, stripeWebhookSecret as string)
  } catch {
    throw badRequest('Invalid Stripe webhook signature')
  }

  const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
    ...STATUS_MAP_ACTIVE_TRIAL_PASTDUE_UNPAID, canceled: 'cancelled',
  }

  switch (stripeEvent.type) {
    case 'checkout.session.completed': {
      const session = stripeEvent.data.object as {
        id: string; customer: string | null; subscription: string | null
        metadata: Record<string, string>
        payment_status: string
      }
      console.log('[stripe-webhook] checkout.session.completed', { sessionId: session.id, sub: session.subscription, meta: session.metadata })
      // Only handle subscription checkouts
      if (!session.subscription) break
      const userId = session.metadata?.userId
      if (!userId) {
        console.warn('[stripe-webhook] checkout.session.completed missing userId in metadata')
        break
      }
      assertWebhookSiteMatch(event, session.metadata?.siteId)

      // Fetch the subscription from Stripe to get full details
      let stripeSub: Awaited<ReturnType<StripeProvider['getSubscription']>>
      try {
        stripeSub = await stripe.getSubscription(session.subscription)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        console.error('[stripe-webhook] Failed to fetch subscription', detail)
        // A transient failure here (rate limit, network blip) must not be swallowed as a
        // 200 — Stripe treats 2xx as "delivered" and stops retrying, which would
        // permanently leave this subscription unsynced despite a successful payment.
        // Throwing surfaces a non-2xx response so Stripe's own retry/backoff picks it
        // back up; the redelivery is safe to reprocess now that the upsert is an atomic
        // conflict-safe operation (see webhook-sync.ts).
        throw createError({ statusCode: 502, message: `Failed to fetch Stripe subscription ${session.subscription}: ${detail}` })
      }
      // Current API versions carry the billing period on each subscription item
      // rather than on the subscription itself.
      const stripeSubItem = stripeSub.items.data[0]

      await upsertSubscriptionFromWebhook(event, {
        provider: 'stripe',
        userId,
        providerSubscriptionId: stripeSub.id,
        providerCustomerId: typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id,
        status: statusMap[stripeSub.status] ?? 'active',
        tierLookupId: stripeSubItem?.price?.id,
        currentPeriodStart: stripeSubItem ? new Date(stripeSubItem.current_period_start * 1000).toISOString() : undefined,
        currentPeriodEnd: stripeSubItem ? new Date(stripeSubItem.current_period_end * 1000).toISOString() : undefined,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        pushOnActivation: true,
      })
      console.log('[stripe-webhook] checkout.session.completed handled', { userId, subId: stripeSub.id })
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const eventSub = stripeEvent.data.object as unknown as { id: string; metadata: Record<string, string> }
      const userId = eventSub.metadata?.userId
      if (!userId) {
        console.warn('[stripe-webhook] subscription event missing userId in metadata')
        break
      }
      assertWebhookSiteMatch(event, eventSub.metadata?.siteId)

      // Re-fetch current state rather than trusting the embedded payload — Stripe (like
      // every provider here) gives no delivery-order guarantee across webhook events, so a
      // `*.updated` event carrying stale "still active" data can arrive AFTER a `*.deleted`
      // event for the same subscription already cancelled it, silently reactivating paid
      // access with no trace. Mirrors the same defensive re-fetch checkout.session.completed
      // already does above.
      let stripeSub: Awaited<ReturnType<StripeProvider['getSubscription']>>
      try {
        stripeSub = await stripe.getSubscription(eventSub.id)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        console.error('[stripe-webhook] Failed to fetch subscription', detail)
        throw createError({ statusCode: 502, message: `Failed to fetch Stripe subscription ${eventSub.id}: ${detail}` })
      }
      const stripeSubItem = stripeSub.items.data[0]
      console.log('[stripe-webhook] subscription event', stripeEvent.type, { subId: stripeSub.id, userId })

      await upsertSubscriptionFromWebhook(event, {
        provider: 'stripe',
        userId,
        providerSubscriptionId: stripeSub.id,
        providerCustomerId: typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id,
        status: statusMap[stripeSub.status] ?? 'active',
        tierLookupId: stripeSubItem?.price?.id,
        currentPeriodStart: stripeSubItem ? new Date(stripeSubItem.current_period_start * 1000).toISOString() : undefined,
        currentPeriodEnd: stripeSubItem ? new Date(stripeSubItem.current_period_end * 1000).toISOString() : undefined,
        // Syncs the flag if the customer cancels via Stripe's own customer portal (or
        // reactivates before the period ends) rather than through our own cancel route —
        // this is the one provider we re-fetch fresh enough state from to know either way.
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        pushOnActivation: true,
      })
      break
    }
    case 'customer.subscription.deleted': {
      const sub = stripeEvent.data.object as { id: string; metadata?: Record<string, string> }
      assertWebhookSiteMatch(event, sub.metadata?.siteId)
      await cancelSubscriptionFromWebhook(event, { provider: 'stripe', providerSubscriptionId: sub.id })
      break
    }
    default:
      console.log('[stripe-webhook] unhandled event type:', stripeEvent.type)
  }
}

// ── Lemon Squeezy ────────────────────────────────────────────────────────────

async function handleLemonSqueezyWebhook(event: H3Event, rawBody: string) {
  const ls = await getLemonSqueezyProvider(event)
  const lsWebhookSecret = await resolveSetting(event, 'payments.ls_webhook_secret', 'lsWebhookSecret')
  const sig = getHeader(event, 'x-signature') ?? ''

  const valid = await ls.verifyWebhook(rawBody, sig, lsWebhookSecret as string)
  if (!valid) throw badRequest('Invalid Lemon Squeezy webhook signature')

  const payload = JSON.parse(rawBody) as {
    meta: { event_name: string; custom_data?: { user_id?: string; site_id?: string } }
    data: { id: string; attributes: { status: string; customer_id: number; variant_id: number; renews_at: string | null } }
  }

  const userId = payload.meta.custom_data?.user_id
  if (!userId) return
  assertWebhookSiteMatch(event, payload.meta.custom_data?.site_id)

  const eventName = payload.meta.event_name
  const sub = payload.data

  if (['subscription_created', 'subscription_updated', 'subscription_resumed'].includes(eventName)) {
    const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
      ...STATUS_MAP_ACTIVE_TRIAL_PASTDUE_UNPAID, on_trial: 'trialing', cancelled: 'cancelled', expired: 'cancelled',
    }
    // Re-fetch current state — LS gives no delivery-order guarantee across webhook events
    // either; trusting the embedded payload risks the same stale-reactivation window
    // described in the Stripe handler above.
    const fresh = await ls.getSubscription(sub.id)
    await upsertSubscriptionFromWebhook(event, {
      provider: 'lemonsqueezy',
      userId,
      providerSubscriptionId: fresh.id,
      providerCustomerId: String(fresh.attributes.customer_id),
      status: statusMap[fresh.attributes.status] ?? 'active',
      tierLookupId: String(fresh.attributes.variant_id),
      currentPeriodEnd: fresh.attributes.renews_at ?? undefined,
      pushOnActivation: eventName === 'subscription_created',
    })
  } else if (['subscription_cancelled', 'subscription_expired'].includes(eventName)) {
    await cancelSubscriptionFromWebhook(event, { provider: 'lemonsqueezy', providerSubscriptionId: sub.id })
  }
}

// ── Paddle ───────────────────────────────────────────────────────────────────

async function handlePaddleWebhook(event: H3Event, rawBody: string) {
  const paddle = await getPaddleProvider(event)
  const paddleWebhookPublicKey = await resolveSetting(event, 'payments.paddle_webhook_public_key', 'paddleWebhookPublicKey')
  const sig = getHeader(event, 'paddle-signature') ?? ''

  const valid = await paddle.verifyWebhook(rawBody, sig, paddleWebhookPublicKey as string)
  if (!valid) throw badRequest('Invalid Paddle webhook signature')

  const payload = JSON.parse(rawBody) as {
    event_type: string
    data: {
      id: string; status: string; customer_id: string
      custom_data?: { user_id?: string; site_id?: string }
      items?: Array<{ price: { id: string } }>
      current_billing_period?: { starts_at: string; ends_at: string } | null
      canceled_at?: string | null
    }
  }

  const userId = payload.data.custom_data?.user_id
  if (!userId) return
  assertWebhookSiteMatch(event, payload.data.custom_data?.site_id)

  const sub = payload.data

  if (['subscription.created', 'subscription.updated', 'subscription.activated'].includes(payload.event_type)) {
    const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
      ...STATUS_MAP_ACTIVE_TRIAL_PASTDUE_UNPAID, canceled: 'cancelled', paused: 'cancelled',
    }
    // Re-fetch current state — Paddle gives no delivery-order guarantee across webhook
    // events either; trusting the embedded payload risks the same stale-reactivation
    // window described in the Stripe handler above.
    const fresh = await paddle.getSubscription(sub.id)
    await upsertSubscriptionFromWebhook(event, {
      provider: 'paddle',
      userId,
      providerSubscriptionId: fresh.id,
      providerCustomerId: fresh.customer_id,
      status: statusMap[fresh.status] ?? 'active',
      tierLookupId: fresh.items?.[0]?.price?.id,
      currentPeriodStart: fresh.current_billing_period?.starts_at,
      currentPeriodEnd: fresh.current_billing_period?.ends_at,
      pushOnActivation: payload.event_type === 'subscription.activated',
    })
  } else if (payload.event_type === 'subscription.canceled') {
    await cancelSubscriptionFromWebhook(event, {
      provider: 'paddle',
      providerSubscriptionId: sub.id,
      cancelledAt: sub.canceled_at ?? undefined,
    })
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default defineEventHandler(async (event) => {
  // Every request here does real work (a resolveSetting() DB round trip that decrypts a
  // sensitive setting, then signature verification) before an invalid one is rejected, so
  // this endpoint needs the same rate-limit floor as other credential-adjacent routes.
  // There's no per-tenant identity available pre-verification, so this is IP-based like
  // the auth endpoints in 04.auth-override.ts. 100/minute is generous enough to absorb a
  // legitimate provider's retry/backoff burst (Stripe in particular can send a lot of
  // events in a short window during a payment surge) while still bounding a hostile flood.
  await rateLimit(event, { limit: 100, windowMs: 60_000, keyPrefix: 'payment-webhook' })

  const provider = getRouterParam(event, 'provider')
  const rawBody = await readRawBody(event) ?? ''

  switch (provider) {
    case 'stripe':
      await handleStripeWebhook(event, rawBody)
      break
    case 'lemonsqueezy':
      await handleLemonSqueezyWebhook(event, rawBody)
      break
    case 'paddle':
      await handlePaddleWebhook(event, rawBody)
      break
    default:
      throw badRequest(`Unknown provider: ${provider}`)
  }

  return { received: true }
})
