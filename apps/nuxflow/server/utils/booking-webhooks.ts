import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { classPasses, classPassHoldings, contentItems, eventRsvps, membershipTiers, subscriptions } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { fromMinorUnits } from '../../shared/lib/money'
import { useDb } from './db'
import { requireSiteId } from './site-context'
import { assertWebhookSiteMatch } from './payments/webhook-sync'
import { recordPassPurchase, sendPassPurchasedEmail } from './class-passes'
import { applyStripeRefundToBookings, releaseExpiredCheckout, settleBookingPayment } from './event-rsvp'
import { expireShopOrder, settleShopOrder } from './shop-checkout'
import { applyRefundToAppointments, releaseAppointmentCheckout, settleAppointmentPayment } from './appointments'
import {
  createOrder,
  findOrderByPaymentIntent,
  findOrderForSession,
  getOrderLines,
  markOrderExpired,
  markOrderPaid,
  recordStripeRefundTotal,
  refundPayment,
  setLineRecord,
  type NewOrderLine,
  type NuxflowKind,
  type OrderRow,
} from './orders'

/**
 * The one-off payments on a site's Stripe webhook: shop orders (shop-checkout.ts), bookings,
 * class passes and one-time membership tiers. Subscriptions stay in the webhook route. Each payment has an order (see
 * orders.ts), which is marked paid first; then what was bought is handed over. Every handler
 * can run twice for one payment, since Stripe redelivers.
 */

export interface StripeCheckoutSession {
  id: string
  mode?: string | null
  payment_status?: string | null
  payment_intent?: string | { id: string } | null
  amount_total?: number | null
  amount_subtotal?: number | null
  currency?: string | null
  metadata?: Record<string, string> | null
  total_details?: { amount_tax?: number | null; amount_shipping?: number | null; amount_discount?: number | null } | null
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null
}

type OneOffKind = Exclude<NuxflowKind, 'order'>

function intentId(session: StripeCheckoutSession): string | null {
  const intent = session.payment_intent
  return typeof intent === 'string' ? intent : intent?.id ?? null
}

/**
 * What a checkout is for. `nuxflowKind` since orders arrived; checkouts opened before that
 * carry `nuxflowBooking`, or for a one-time tier only its ids, and still have to settle.
 */
export function oneOffKind(session: StripeCheckoutSession): OneOffKind | null {
  const metadata = session.metadata ?? {}
  const kind = metadata.nuxflowKind
  if (kind === 'booking' || kind === 'pass' || kind === 'tier' || kind === 'appointment') return kind
  if (kind) return null
  if (metadata.nuxflowBooking === 'rsvp') return 'booking'
  if (metadata.nuxflowBooking === 'pass') return 'pass'
  if (session.mode === 'payment' && !metadata.nuxflowBooking && metadata.tierId && metadata.userId) return 'tier'
  return null
}

/**
 * The line for a payment that arrived with no order — a checkout opened before orders
 * existed. It's recorded anyway, so every payment is on the Orders page.
 */
async function describeLegacyPayment(event: H3Event, kind: OneOffKind, metadata: Record<string, string>, totalMinor: number): Promise<{ line: NewOrderLine; email: string; name: string; userId?: string }> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  if (kind === 'booking') {
    const rsvp = metadata.rsvpId ? await db.query.eventRsvps.findFirst({ where: and(eq(eventRsvps.id, metadata.rsvpId), eq(eventRsvps.siteId, siteId)) }) : undefined
    const item = rsvp ? await db.query.contentItems.findFirst({ where: and(eq(contentItems.id, rsvp.contentItemId), eq(contentItems.siteId, siteId)), columns: { title: true } }) : undefined
    const seats = Math.max(1, rsvp?.seats ?? 1)
    return {
      email: rsvp?.email ?? '',
      name: rsvp?.name ?? '',
      line: { kind, refId: rsvp?.contentItemId ?? null, recordId: rsvp?.id ?? null, name: item?.title ?? 'Booking', quantity: seats, unitMinor: Math.round(totalMinor / seats) },
    }
  }
  if (kind === 'appointment') {
    return {
      email: metadata.email ?? '',
      name: '',
      line: { kind, refId: null, recordId: metadata.appointmentId ?? null, name: 'Appointment', quantity: 1, unitMinor: totalMinor },
    }
  }
  if (kind === 'pass') {
    const pass = metadata.passId ? await db.query.classPasses.findFirst({ where: and(eq(classPasses.id, metadata.passId), eq(classPasses.siteId, siteId)), columns: { name: true } }) : undefined
    return {
      email: metadata.email ?? '',
      name: metadata.name ?? '',
      line: { kind, refId: metadata.passId ?? null, name: pass?.name ?? 'Class pass', quantity: 1, unitMinor: totalMinor },
    }
  }
  const tier = metadata.tierId ? await db.query.membershipTiers.findFirst({ where: and(eq(membershipTiers.id, metadata.tierId), eq(membershipTiers.siteId, siteId)), columns: { name: true } }) : undefined
  return {
    email: '',
    name: '',
    userId: metadata.userId,
    line: { kind, refId: metadata.tierId ?? null, name: tier?.name ?? 'Membership', quantity: 1, unitMinor: totalMinor },
  }
}

/** Marks the checkout's order paid, making one first if it has none. */
async function settleOrder(event: H3Event, session: StripeCheckoutSession, kind: OneOffKind): Promise<OrderRow> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const currency = (session.currency ?? 'usd').toUpperCase()
  const paid = {
    id: session.id,
    paymentIntentId: intentId(session),
    totalMinor: session.amount_total ?? 0,
    taxMinor: session.total_details?.amount_tax ?? 0,
    shippingMinor: session.total_details?.amount_shipping ?? 0,
    discountMinor: session.total_details?.amount_discount ?? 0,
    name: session.customer_details?.name ?? null,
  }
  const existing = await findOrderForSession(db, siteId, session)
  if (existing) return (await markOrderPaid(db, siteId, existing, paid)).order

  const legacy = await describeLegacyPayment(event, kind, session.metadata ?? {}, paid.totalMinor)
  return createOrder(db, siteId, {
    email: legacy.email || session.customer_details?.email || '',
    name: legacy.name || session.customer_details?.name || '',
    userId: legacy.userId ?? null,
    currency,
    lines: [legacy.line],
    status: 'paid',
    stripeSessionId: session.id,
    stripePaymentIntentId: paid.paymentIntentId,
    totalMinor: paid.totalMinor,
  })
}

/** Handles a completed one-off checkout. False when it's a subscription's, for the route to handle. */
export async function handleOneOffCheckoutCompleted(event: H3Event, session: StripeCheckoutSession): Promise<boolean> {
  const metadata = session.metadata ?? {}
  if (metadata.nuxflowKind === 'order') {
    assertWebhookSiteMatch(event, metadata.siteId)
    if (session.payment_status === 'paid') await settleShopOrder(event, session)
    else console.warn(`[shop-webhook] Checkout ${session.id} completed unpaid (${session.payment_status})`)
    return true
  }
  const kind = oneOffKind(session)
  if (!kind) return false
  assertWebhookSiteMatch(event, metadata.siteId)
  // Card only, so a completed checkout has been paid; this is a guard, not a code path.
  if (session.payment_status !== 'paid') {
    console.warn(`[booking-webhook] Checkout ${session.id} completed unpaid (${session.payment_status})`)
    return true
  }

  const db = useDb(event)
  const siteId = requireSiteId(event)
  const currency = (session.currency ?? 'usd').toUpperCase()
  const amount = fromMinorUnits(session.amount_total ?? 0, currency)
  const paymentIntentId = intentId(session)
  const order = await settleOrder(event, session, kind)

  if (kind === 'appointment' && metadata.appointmentId) {
    await settleAppointmentPayment(event, { appointmentId: metadata.appointmentId, sessionId: session.id, paymentIntentId, amount, currency })
  }
  else if (kind === 'booking' && metadata.rsvpId) {
    await settleBookingPayment(event, { rsvpId: metadata.rsvpId, sessionId: session.id, paymentIntentId, amount, currency })
  }
  else if (kind === 'pass' && metadata.passId && metadata.email) {
    const recorded = await recordPassPurchase(db, siteId, {
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
      if (paymentIntentId) await refundPayment(event, { paymentIntentId, idempotencyKey: `pass-gone-${session.id}`, reason: 'The pass was no longer on sale' })
    }
    else {
      await setLineRecord(db, siteId, order.id, 'pass', recorded.holding.id)
      if (recorded.created) await sendPassPurchasedEmail(event, recorded.holding).catch(err => console.error('[booking-webhook] Pass email failed:', err))
    }
  }
  else if (kind === 'tier' && metadata.userId && metadata.tierId) {
    const subscriptionId = await activateOneTimeTier(event, metadata.userId, metadata.tierId, session.id)
    if (subscriptionId) await setLineRecord(db, siteId, order.id, 'tier', subscriptionId)
  }
  return true
}

/**
 * A one-time membership tier: access with no end date. It's stored the way a free tier is,
 * under the `free_` prefix that means "no provider subscription behind this row", so cancel,
 * the billing portal and account deletion all leave Stripe alone. Buying again reactivates
 * the same row (`idx_subscriptions_unique_free_tier`).
 */
async function activateOneTimeTier(event: H3Event, userId: string, tierId: string, sessionId: string): Promise<string | null> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const start = new Date().toISOString()
  const end = new Date(Date.now() + 100 * 365 * 86_400_000).toISOString()
  const [row] = await db.insert(subscriptions).values({
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
  }).returning({ id: subscriptions.id })
  return row?.id ?? null
}

/** A checkout closed unpaid: its order expires, and a booking's held place is let go. */
export async function handleOneOffCheckoutExpired(event: H3Event, session: StripeCheckoutSession): Promise<void> {
  if (session.metadata?.nuxflowKind === 'order') {
    assertWebhookSiteMatch(event, session.metadata.siteId)
    await expireShopOrder(event, session)
    return
  }
  const kind = oneOffKind(session)
  if (!kind) return
  const metadata = session.metadata ?? {}
  assertWebhookSiteMatch(event, metadata.siteId)
  await markOrderExpired(useDb(event), requireSiteId(event), session.id)
  if (kind === 'booking' && metadata.rsvpId) await releaseExpiredCheckout(event, metadata.rsvpId, session.id)
  if (kind === 'appointment' && metadata.appointmentId) await releaseAppointmentCheckout(event, metadata.appointmentId, session.id)
}

/**
 * After money has gone back on a payment, however it was refunded: the booking, pass or
 * membership it paid for follows. `refundedMinor` is the payment's total refunded so far.
 * A partial refund is a goodwill gesture: a booking or membership stands, and a pass only
 * records it. A full one ends what was bought.
 */
export async function applyRefundToRecords(event: H3Event, paymentIntentId: string, refund: { refundedMinor: number; paymentMinor: number; currency: string }): Promise<void> {
  const fully = refund.refundedMinor >= refund.paymentMinor
  if (fully) {
    await applyStripeRefundToBookings(event, paymentIntentId)
    await applyRefundToAppointments(event, paymentIntentId)
  }

  const db = useDb(event)
  const siteId = requireSiteId(event)
  const holding = await db.query.classPassHoldings.findFirst({
    where: and(eq(classPassHoldings.siteId, siteId), eq(classPassHoldings.stripePaymentIntentId, paymentIntentId)),
  })
  if (holding) {
    await db.update(classPassHoldings)
      .set({
        amountRefunded: fromMinorUnits(refund.refundedMinor, refund.currency.toUpperCase()),
        // Refunded in full: nothing more can be spent. Our own pass refunds set this already.
        ...(fully ? { status: 'refunded' as const } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(classPassHoldings.id, holding.id), eq(classPassHoldings.siteId, siteId)))
  }

  if (!fully) return
  const order = await findOrderByPaymentIntent(db, siteId, paymentIntentId)
  if (!order) return
  for (const line of await getOrderLines(db, siteId, order.id)) {
    if (line.kind !== 'tier' || !line.recordId) continue
    // Only the one-time access this payment bought: a real subscription isn't a `free_` row.
    await db.update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(and(eq(subscriptions.id, line.recordId), eq(subscriptions.siteId, siteId), sql`substr(${subscriptions.providerSubscriptionId}, 1, 10) = 'free_once_'`))
  }
}

/**
 * Keeps our records true when money goes back. Refunds made here have already done this, so
 * it matters for ones made in Stripe's own dashboard. A charge carries no site, so it's only
 * looked up on this site, and an unknown payment is simply someone else's.
 */
export async function handleChargeRefunded(event: H3Event, charge: { payment_intent?: string | { id: string } | null; amount: number; amount_refunded: number; currency: string }): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntentId) return
  await recordStripeRefundTotal(useDb(event), requireSiteId(event), paymentIntentId, charge.amount_refunded)
  await applyRefundToRecords(event, paymentIntentId, { refundedMinor: charge.amount_refunded, paymentMinor: charge.amount, currency: charge.currency })
}
