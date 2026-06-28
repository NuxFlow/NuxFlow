/* eslint-disable no-console */
import type { H3Event } from 'h3'
import { subscriptions, membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../../utils/db'
import { StripeProvider } from '../../../../utils/payments/stripe'
import { LemonSqueezyProvider } from '../../../../utils/payments/lemonsqueezy'
import { PaddleProvider } from '../../../../utils/payments/paddle'
import { resolveSetting } from '../../../../utils/settings'
import { sendPushToUser } from '../../../../utils/webpush'

async function maybeSendPaymentPush(event: H3Event, userId: string, tierName: string | undefined) {
  const enabled = await resolveSetting(event, 'push.events.payment_confirmation')
  if (enabled !== 'true') return
  sendPushToUser(event, userId, {
    title: 'Subscription confirmed',
    body: tierName ? `You're now subscribed to ${tierName}.` : 'Your subscription is now active.',
    url: '/account',
  }).catch(err => console.error('[push] Payment push failed:', err))
}

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

  const db = useDb(event)
  const siteId = event.context.siteId as string

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

      const tier = await db.query.membershipTiers.findFirst({
        where: and(eq(membershipTiers.siteId, siteId), eq(membershipTiers.stripePriceId, stripeSub.items.data[0]?.price?.id ?? '')),
      })
      const existing = await db.query.subscriptions.findFirst({
        where: and(eq(subscriptions.providerSubscriptionId, stripeSub.id), eq(subscriptions.provider, 'stripe')),
      })
      const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
        active: 'active', trialing: 'trialing', past_due: 'past_due', canceled: 'cancelled', unpaid: 'unpaid',
      }
      const status = statusMap[stripeSub.status] ?? 'active'
      const periodStart = new Date(stripeSub.current_period_start * 1000).toISOString()
      const periodEnd = new Date(stripeSub.current_period_end * 1000).toISOString()

      if (existing) {
        await db.update(subscriptions)
          .set({ status, tierId: tier?.id ?? null, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd })
          .where(eq(subscriptions.id, existing.id))
      } else {
        await db.insert(subscriptions).values({
          id: ulid(), siteId, userId, tierId: tier?.id ?? null,
          provider: 'stripe', providerSubscriptionId: stripeSub.id,
          providerCustomerId: String(stripeSub.customer),
          status, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
        })
        if (status === 'active' || status === 'trialing') {
          await maybeSendPaymentPush(event, userId, tier?.name)
        }
      }
      console.log('[stripe-webhook] checkout.session.completed handled', { userId, status, subId: stripeSub.id })
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

      const tier = await db.query.membershipTiers.findFirst({
        where: and(eq(membershipTiers.siteId, siteId), eq(membershipTiers.stripePriceId, sub.items.data[0]?.price?.id ?? '')),
      })
      const existing = await db.query.subscriptions.findFirst({
        where: and(eq(subscriptions.providerSubscriptionId, sub.id), eq(subscriptions.provider, 'stripe')),
      })
      const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
        active: 'active', trialing: 'trialing', past_due: 'past_due', canceled: 'cancelled', unpaid: 'unpaid',
      }
      const status = statusMap[sub.status] ?? 'active'
      const periodStart = new Date(sub.current_period_start * 1000).toISOString()
      const periodEnd = new Date(sub.current_period_end * 1000).toISOString()

      if (existing) {
        await db.update(subscriptions)
          .set({ status, tierId: tier?.id ?? null, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd })
          .where(eq(subscriptions.id, existing.id))
      } else {
        await db.insert(subscriptions).values({
          id: ulid(), siteId, userId, tierId: tier?.id ?? null,
          provider: 'stripe', providerSubscriptionId: sub.id,
          providerCustomerId: String(sub.customer),
          status, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
        })
        if (status === 'active' || status === 'trialing') {
          await maybeSendPaymentPush(event, userId, tier?.name)
        }
      }
      break
    }
    case 'customer.subscription.deleted': {
      const sub = stripeEvent.data.object as { id: string }
      await db.update(subscriptions)
        .set({ status: 'cancelled', cancelledAt: new Date().toISOString() })
        .where(and(eq(subscriptions.providerSubscriptionId, sub.id), eq(subscriptions.provider, 'stripe')))
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

  const db = useDb(event)
  const siteId = event.context.siteId as string
  const userId = payload.meta.custom_data?.user_id
  if (!userId) return

  const eventName = payload.meta.event_name
  const sub = payload.data

  if (['subscription_created', 'subscription_updated', 'subscription_resumed'].includes(eventName)) {
    const tier = await db.query.membershipTiers.findFirst({
      where: and(eq(membershipTiers.siteId, siteId), eq(membershipTiers.lsVariantId, String(sub.attributes.variant_id))),
    })
    const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
      active: 'active', on_trial: 'trialing', past_due: 'past_due', cancelled: 'cancelled', expired: 'cancelled', unpaid: 'unpaid',
    }
    const status = statusMap[sub.attributes.status] ?? 'active'
    const existing = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.providerSubscriptionId, sub.id), eq(subscriptions.provider, 'lemonsqueezy')),
    })
    if (existing) {
      await db.update(subscriptions)
        .set({ status, tierId: tier?.id ?? null, currentPeriodEnd: sub.attributes.renews_at ?? undefined })
        .where(eq(subscriptions.id, existing.id))
    } else {
      await db.insert(subscriptions).values({
        id: ulid(), siteId, userId, tierId: tier?.id ?? null,
        provider: 'lemonsqueezy', providerSubscriptionId: sub.id,
        providerCustomerId: String(sub.attributes.customer_id),
        status, currentPeriodEnd: sub.attributes.renews_at ?? undefined,
      })
      if (eventName === 'subscription_created' && (status === 'active' || status === 'trialing')) {
        await maybeSendPaymentPush(event, userId, tier?.name)
      }
    }
  } else if (['subscription_cancelled', 'subscription_expired'].includes(eventName)) {
    await db.update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date().toISOString() })
      .where(and(eq(subscriptions.providerSubscriptionId, sub.id), eq(subscriptions.provider, 'lemonsqueezy')))
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

  const db = useDb(event)
  const siteId = event.context.siteId as string
  const userId = payload.data.custom_data?.user_id
  if (!userId) return

  const sub = payload.data

  if (['subscription.created', 'subscription.updated', 'subscription.activated'].includes(payload.event_type)) {
    const priceId = sub.items?.[0]?.price?.id
    const tier = priceId
      ? await db.query.membershipTiers.findFirst({
          where: and(eq(membershipTiers.siteId, siteId), eq(membershipTiers.paddleProductId, priceId)),
        })
      : null

    const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
      active: 'active', trialing: 'trialing', past_due: 'past_due', canceled: 'cancelled', paused: 'cancelled',
    }
    const status = statusMap[sub.status] ?? 'active'
    const existing = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.providerSubscriptionId, sub.id), eq(subscriptions.provider, 'paddle')),
    })
    if (existing) {
      await db.update(subscriptions)
        .set({ status, tierId: tier?.id ?? null, currentPeriodStart: sub.current_billing_period?.starts_at, currentPeriodEnd: sub.current_billing_period?.ends_at })
        .where(eq(subscriptions.id, existing.id))
    } else {
      await db.insert(subscriptions).values({
        id: ulid(), siteId, userId, tierId: tier?.id ?? null,
        provider: 'paddle', providerSubscriptionId: sub.id,
        providerCustomerId: sub.customer_id,
        status, currentPeriodStart: sub.current_billing_period?.starts_at, currentPeriodEnd: sub.current_billing_period?.ends_at,
      })
      if (payload.event_type === 'subscription.activated' && (status === 'active' || status === 'trialing')) {
        await maybeSendPaymentPush(event, userId, tier?.name)
      }
    }
  } else if (payload.event_type === 'subscription.canceled') {
    await db.update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: sub.canceled_at ?? new Date().toISOString() })
      .where(and(eq(subscriptions.providerSubscriptionId, sub.id), eq(subscriptions.provider, 'paddle')))
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
