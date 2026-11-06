import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { classPassHoldings, subscriptions } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { useDb } from './db'
import { requireSiteId } from './site-context'
import { getStripeProvider } from './payments/resolve'
import { fromStripeUnitAmount } from './payments/stripe'
import { assertWebhookSiteMatch } from './payments/webhook-sync'
import { recordPassPurchase, sendPassPurchasedEmail } from './class-passes'
import { applyStripeRefundToBookings, releaseExpiredCheckout, settleBookingPayment } from './event-rsvp'

/**
 * The one-off payments on a site's Stripe webhook: bookings, class passes and one-time
 * membership tiers. Subscriptions stay in the webhook route. Every handler can run twice
 * for one payment, since Stripe redelivers.
 */

export interface StripeCheckoutSession {
  id: string
  mode?: string | null
  payment_status?: string | null
  payment_intent?: string | { id: string } | null
  amount_total?: number | null
  currency?: string | null
  metadata?: Record<string, string> | null
}

function intentId(session: StripeCheckoutSession): string | null {
  const intent = session.payment_intent
  return typeof intent === 'string' ? intent : intent?.id ?? null
}

/** Handles a completed one-off checkout. False when it's a subscription's, for the route to handle. */
export async function handleOneOffCheckoutCompleted(event: H3Event, session: StripeCheckoutSession): Promise<boolean> {
  const metadata = session.metadata ?? {}
  const kind = metadata.nuxflowBooking
  const oneTimeTier = session.mode === 'payment' && !kind && metadata.tierId && metadata.userId
  if (!kind && !oneTimeTier) return false
  assertWebhookSiteMatch(event, metadata.siteId)
  // Card only, so a completed checkout has been paid; this is a guard, not a code path.
  if (session.payment_status !== 'paid') {
    console.warn(`[booking-webhook] Checkout ${session.id} completed unpaid (${session.payment_status})`)
    return true
  }

  const currency = (session.currency ?? 'usd').toUpperCase()
  const amount = fromStripeUnitAmount(session.amount_total ?? 0, currency)
  const paymentIntentId = intentId(session)

  if (kind === 'rsvp' && metadata.rsvpId) {
    await settleBookingPayment(event, { rsvpId: metadata.rsvpId, sessionId: session.id, paymentIntentId, amount, currency })
  }
  else if (kind === 'pass' && metadata.passId && metadata.email) {
    const recorded = await recordPassPurchase(useDb(event), requireSiteId(event), {
      passId: metadata.passId,
      email: metadata.email,
      name: metadata.name ?? '',
      amountPaid: amount,
      currency,
      sessionId: session.id,
      paymentIntentId,
    })
    if (!recorded) {
      // The pass was deleted while they were paying, so there's nothing to give them.
      console.warn(`[booking-webhook] Pass ${metadata.passId} is gone; refunding ${session.id}`)
      if (paymentIntentId) {
        const stripe = await getStripeProvider(event)
        await stripe.refundPayment({ paymentIntentId, idempotencyKey: `pass-gone-${session.id}` })
      }
    }
    else if (recorded.created) {
      await sendPassPurchasedEmail(event, recorded.holding).catch(err => console.error('[booking-webhook] Pass email failed:', err))
    }
  }
  else if (oneTimeTier) {
    await activateOneTimeTier(event, metadata.userId!, metadata.tierId!, session.id)
  }
  return true
}

/**
 * A one-time membership tier: access with no end date. It's stored the way a free tier is,
 * under the `free_` prefix that means "no provider subscription behind this row", so cancel,
 * the billing portal and account deletion all leave Stripe alone. Buying again reactivates
 * the same row (`idx_subscriptions_unique_free_tier`).
 */
async function activateOneTimeTier(event: H3Event, userId: string, tierId: string, sessionId: string): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const start = new Date().toISOString()
  const end = new Date(Date.now() + 100 * 365 * 86_400_000).toISOString()
  await db.insert(subscriptions).values({
    id: ulid(),
    siteId,
    userId,
    tierId,
    provider: 'stripe',
    providerSubscriptionId: `free_once_${sessionId}`,
    status: 'active',
    currentPeriodStart: start,
    currentPeriodEnd: end,
  }).onConflictDoUpdate({
    target: [subscriptions.siteId, subscriptions.userId, subscriptions.tierId],
    // Must stay identical to the index's own WHERE, as in memberships/checkout.post.ts.
    targetWhere: sql`substr(provider_subscription_id, 1, 5) = 'free_'`,
    set: { status: 'active', currentPeriodStart: start, currentPeriodEnd: end, cancelledAt: null, updatedAt: sql`(datetime('now'))` },
  })
}

/** A checkout closed unpaid. Passes and tiers have nothing to undo. */
export async function handleOneOffCheckoutExpired(event: H3Event, session: StripeCheckoutSession): Promise<void> {
  const metadata = session.metadata ?? {}
  if (metadata.nuxflowBooking !== 'rsvp' || !metadata.rsvpId) return
  assertWebhookSiteMatch(event, metadata.siteId)
  await releaseExpiredCheckout(event, metadata.rsvpId, session.id)
}

/**
 * Keeps our records true when money goes back. Refunds made here have already done this, so
 * it matters for ones made in Stripe's own dashboard. A charge carries no site, so it's only
 * looked up on this site, and an unknown payment is simply someone else's.
 */
export async function handleChargeRefunded(event: H3Event, charge: { payment_intent?: string | { id: string } | null; amount: number; amount_refunded: number; currency: string }): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntentId) return
  const fully = charge.amount_refunded >= charge.amount
  // A partial refund is a goodwill gesture made in Stripe. The booking stands.
  if (fully) await applyStripeRefundToBookings(event, paymentIntentId)

  const db = useDb(event)
  const siteId = requireSiteId(event)
  const holding = await db.query.classPassHoldings.findFirst({
    where: and(eq(classPassHoldings.siteId, siteId), eq(classPassHoldings.stripePaymentIntentId, paymentIntentId)),
  })
  if (!holding) return
  const refunded = fromStripeUnitAmount(charge.amount_refunded, charge.currency.toUpperCase())
  await db.update(classPassHoldings)
    .set({
      amountRefunded: refunded,
      // Fully refunded from the dashboard: nothing more can be spent. Ours sets this already.
      ...(fully ? { status: 'refunded' as const } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(classPassHoldings.id, holding.id), eq(classPassHoldings.siteId, siteId)))
}
