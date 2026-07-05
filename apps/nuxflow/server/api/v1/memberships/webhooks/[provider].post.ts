/* eslint-disable no-console */
import type { H3Event } from 'h3'
import { StripeProvider } from '../../../../utils/payments/stripe'
import { LemonSqueezyProvider } from '../../../../utils/payments/lemonsqueezy'
import { PaddleProvider } from '../../../../utils/payments/paddle'
import { upsertSubscriptionFromWebhook, cancelSubscriptionFromWebhook } from '../../../../utils/payments/webhook-sync'
import { resolveSetting } from '../../../../utils/settings'

const STATUS_MAP_ACTIVE_TRIAL_PASTDUE_UNPAID = {
  active: 'active', trialing: 'trialing', past_due: 'past_due', unpaid: 'unpaid',
} as const

// ── Stripe ───────────────────────────────────────────────────────────────────

async function handleStripeWebhook(event: H3Event, rawBody: string) {
  const stripeSecretKey = await resolveSetting(event, 'payments.stripe_secret_key', 'stripeSecretKey')
  const stripeWebhookSecret = await resolveSetting(event, 'payments.stripe_webhook_secret', 'stripeWebhookSecret')

  if (!stripeSecretKey) {
    throw createError({ statusCode: 503, message: 'Stripe is not configured' })
  }

  const stripe = new StripeProvider(stripeSecretKey as string)
  const sig = getHeader(event, 'stripe-signature') ?? ''

  let stripeEvent: Awaited<ReturnType<StripeProvider['constructWebhookEvent']>>
  try {
    stripeEvent = await stripe.constructWebhookEvent(rawBody, sig, stripeWebhookSecret as string)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid Stripe webhook signature' })
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

      // Fetch the subscription from Stripe to get full details
      const stripeSecretKeyFull = await resolveSetting(event, 'payments.stripe_secret_key', 'stripeSecretKey')
      const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${session.subscription}`, {
        headers: { Authorization: `Bearer ${stripeSecretKeyFull}` },
      })
      if (!subRes.ok) {
        console.error('[stripe-webhook] Failed to fetch subscription', await subRes.text())
        break
      }
      const stripeSub = await subRes.json() as {
        id: string; customer: string; status: string
        items: { data: Array<{ price: { id: string } }> }
        current_period_start: number; current_period_end: number
      }

      await upsertSubscriptionFromWebhook(event, {
        provider: 'stripe',
        userId,
        providerSubscriptionId: stripeSub.id,
        providerCustomerId: String(stripeSub.customer),
        status: statusMap[stripeSub.status] ?? 'active',
        tierLookupId: stripeSub.items.data[0]?.price?.id,
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000).toISOString(),
        pushOnActivation: true,
      })
      console.log('[stripe-webhook] checkout.session.completed handled', { userId, subId: stripeSub.id })
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = stripeEvent.data.object as unknown as {
        id: string; customer: string; status: string
        items: { data: Array<{ price: { id: string } }> }
        current_period_start: number; current_period_end: number
        metadata: Record<string, string>
      }
      console.log('[stripe-webhook] subscription event', stripeEvent.type, { subId: sub.id, meta: sub.metadata })
      const userId = sub.metadata?.userId
      if (!userId) {
        console.warn('[stripe-webhook] subscription event missing userId in metadata')
        break
      }

      await upsertSubscriptionFromWebhook(event, {
        provider: 'stripe',
        userId,
        providerSubscriptionId: sub.id,
        providerCustomerId: String(sub.customer),
        status: statusMap[sub.status] ?? 'active',
        tierLookupId: sub.items.data[0]?.price?.id,
        currentPeriodStart: new Date(sub.current_period_start * 1000).toISOString(),
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        pushOnActivation: true,
      })
      break
    }
    case 'customer.subscription.deleted': {
      const sub = stripeEvent.data.object as { id: string }
      await cancelSubscriptionFromWebhook(event, { provider: 'stripe', providerSubscriptionId: sub.id })
      break
    }
    default:
      console.log('[stripe-webhook] unhandled event type:', stripeEvent.type)
  }
}

// ── Lemon Squeezy ────────────────────────────────────────────────────────────

async function handleLemonSqueezyWebhook(event: H3Event, rawBody: string) {
  const lsApiKey = await resolveSetting(event, 'payments.ls_api_key', 'lsApiKey')
  const lsStoreId = await resolveSetting(event, 'payments.ls_store_id', 'lsStoreId')
  const lsWebhookSecret = await resolveSetting(event, 'payments.ls_webhook_secret', 'lsWebhookSecret')

  if (!lsApiKey || !lsStoreId) {
    throw createError({ statusCode: 503, message: 'Lemon Squeezy is not configured' })
  }

  const ls = new LemonSqueezyProvider(lsApiKey as string, lsStoreId as string)
  const sig = getHeader(event, 'x-signature') ?? ''

  const valid = await ls.verifyWebhook(rawBody, sig, lsWebhookSecret as string)
  if (!valid) throw createError({ statusCode: 400, message: 'Invalid Lemon Squeezy webhook signature' })

  const payload = JSON.parse(rawBody) as {
    meta: { event_name: string; custom_data?: { user_id?: string } }
    data: { id: string; attributes: { status: string; customer_id: number; variant_id: number; renews_at: string | null } }
  }

  const userId = payload.meta.custom_data?.user_id
  if (!userId) return

  const eventName = payload.meta.event_name
  const sub = payload.data

  if (['subscription_created', 'subscription_updated', 'subscription_resumed'].includes(eventName)) {
    const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
      ...STATUS_MAP_ACTIVE_TRIAL_PASTDUE_UNPAID, on_trial: 'trialing', cancelled: 'cancelled', expired: 'cancelled',
    }
    await upsertSubscriptionFromWebhook(event, {
      provider: 'lemonsqueezy',
      userId,
      providerSubscriptionId: sub.id,
      providerCustomerId: String(sub.attributes.customer_id),
      status: statusMap[sub.attributes.status] ?? 'active',
      tierLookupId: String(sub.attributes.variant_id),
      currentPeriodEnd: sub.attributes.renews_at ?? undefined,
      pushOnActivation: eventName === 'subscription_created',
    })
  } else if (['subscription_cancelled', 'subscription_expired'].includes(eventName)) {
    await cancelSubscriptionFromWebhook(event, { provider: 'lemonsqueezy', providerSubscriptionId: sub.id })
  }
}

// ── Paddle ───────────────────────────────────────────────────────────────────

async function handlePaddleWebhook(event: H3Event, rawBody: string) {
  const paddleApiKey = await resolveSetting(event, 'payments.paddle_api_key', 'paddleApiKey')
  const paddleVendorId = await resolveSetting(event, 'payments.paddle_vendor_id', 'paddleVendorId')
  const paddleWebhookPublicKey = await resolveSetting(event, 'payments.paddle_webhook_public_key', 'paddleWebhookPublicKey')

  if (!paddleApiKey || !paddleVendorId) {
    throw createError({ statusCode: 503, message: 'Paddle is not configured' })
  }

  const paddle = new PaddleProvider(paddleApiKey as string, paddleVendorId as string)
  const sig = getHeader(event, 'paddle-signature') ?? ''

  const valid = await paddle.verifyWebhook(rawBody, sig, paddleWebhookPublicKey as string)
  if (!valid) throw createError({ statusCode: 400, message: 'Invalid Paddle webhook signature' })

  const payload = JSON.parse(rawBody) as {
    event_type: string
    data: {
      id: string; status: string; customer_id: string
      custom_data?: { user_id?: string }
      items?: Array<{ price: { id: string } }>
      current_billing_period?: { starts_at: string; ends_at: string } | null
      canceled_at?: string | null
    }
  }

  const userId = payload.data.custom_data?.user_id
  if (!userId) return

  const sub = payload.data

  if (['subscription.created', 'subscription.updated', 'subscription.activated'].includes(payload.event_type)) {
    const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
      ...STATUS_MAP_ACTIVE_TRIAL_PASTDUE_UNPAID, canceled: 'cancelled', paused: 'cancelled',
    }
    await upsertSubscriptionFromWebhook(event, {
      provider: 'paddle',
      userId,
      providerSubscriptionId: sub.id,
      providerCustomerId: sub.customer_id,
      status: statusMap[sub.status] ?? 'active',
      tierLookupId: sub.items?.[0]?.price?.id,
      currentPeriodStart: sub.current_billing_period?.starts_at,
      currentPeriodEnd: sub.current_billing_period?.ends_at,
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
      throw createError({ statusCode: 400, message: `Unknown provider: ${provider}` })
  }

  return { received: true }
})
