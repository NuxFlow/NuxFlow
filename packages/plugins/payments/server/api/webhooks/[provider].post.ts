import type { H3Event } from 'h3'
import { subscriptions, membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { StripeProvider } from '../../providers/stripe'
import { LemonSqueezyProvider } from '../../providers/lemonsqueezy'
import { PaddleProvider } from '../../providers/paddle'

// ── Stripe ──────────────────────────────────────────────────────────────────

async function handleStripeWebhook(event: H3Event, rawBody: string) {
  const config = useRuntimeConfig()
  const stripe = new StripeProvider(config.stripeSecretKey as string)
  const sig = getHeader(event, 'stripe-signature') ?? ''
  const webhookSecret = config.stripeWebhookSecret as string

  let stripeEvent: ReturnType<StripeProvider['constructWebhookEvent']>
  try {
    stripeEvent = stripe.constructWebhookEvent(Buffer.from(rawBody), sig, webhookSecret)
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid Stripe webhook signature' })
  }

  const db = useDb()
  const siteId = event.context.siteId as string

  switch (stripeEvent.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = stripeEvent.data.object as {
        id: string
        customer: string
        status: string
        items: { data: Array<{ price: { product_id: string; id: string } }> }
        current_period_start: number
        current_period_end: number
        metadata: Record<string, string>
      }
      const userId = sub.metadata?.userId
      if (!userId) break

      // Resolve tier by Stripe price ID
      const tier = await db.query.membershipTiers.findFirst({
        where: and(eq(membershipTiers.siteId, siteId), eq(membershipTiers.stripePriceId, sub.items.data[0]?.price?.id ?? '')),
      })

      const existing = await db.query.subscriptions.findFirst({
        where: and(eq(subscriptions.providerSubscriptionId, sub.id), eq(subscriptions.provider, 'stripe')),
      })

      const statusMap: Record<string, 'active' | 'cancelled' | 'past_due' | 'trialing' | 'unpaid'> = {
        active: 'active', trialing: 'trialing', past_due: 'past_due',
        canceled: 'cancelled', unpaid: 'unpaid',
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
  }
}

// ── Lemon Squeezy ────────────────────────────────────────────────────────────

async function handleLemonSqueezyWebhook(event: H3Event, rawBody: string) {
  const config = useRuntimeConfig()
  const ls = new LemonSqueezyProvider(config.lsApiKey as string, config.lsStoreId as string)
  const sig = getHeader(event, 'x-signature') ?? ''

  const valid = await ls.verifyWebhook(rawBody, sig, config.lsWebhookSecret as string)
  if (!valid) throw createError({ statusCode: 400, message: 'Invalid Lemon Squeezy webhook signature' })

  const payload = JSON.parse(rawBody) as {
    meta: { event_name: string; custom_data?: { user_id?: string; site_id?: string } }
    data: { id: string; attributes: { status: string; customer_id: number; variant_id: number; renews_at: string | null; ends_at: string | null } }
  }

  const db = useDb()
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
      active: 'active', on_trial: 'trialing', past_due: 'past_due',
      cancelled: 'cancelled', expired: 'cancelled', unpaid: 'unpaid',
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
    }
  } else if (['subscription_cancelled', 'subscription_expired'].includes(eventName)) {
    await db.update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date().toISOString() })
      .where(and(eq(subscriptions.providerSubscriptionId, sub.id), eq(subscriptions.provider, 'lemonsqueezy')))
  }
}

// ── Paddle ───────────────────────────────────────────────────────────────────

async function handlePaddleWebhook(event: H3Event, rawBody: string) {
  const config = useRuntimeConfig()
  const paddle = new PaddleProvider(config.paddleApiKey as string, config.paddleVendorId as string)
  const sig = getHeader(event, 'paddle-signature') ?? ''

  const valid = await paddle.verifyWebhook(rawBody, sig, config.paddleWebhookPublicKey as string)
  if (!valid) throw createError({ statusCode: 400, message: 'Invalid Paddle webhook signature' })

  const payload = JSON.parse(rawBody) as {
    event_type: string
    data: {
      id: string
      status: string
      customer_id: string
      custom_data?: { user_id?: string; site_id?: string }
      items?: Array<{ price: { id: string } }>
      current_billing_period?: { starts_at: string; ends_at: string } | null
      canceled_at?: string | null
    }
  }

  const db = useDb()
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
      active: 'active', trialing: 'trialing', past_due: 'past_due',
      canceled: 'cancelled', paused: 'cancelled',
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
  // Read raw body for signature verification — must be done before any parsing
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
