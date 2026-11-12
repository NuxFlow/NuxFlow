import type { H3Event } from 'h3'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { orderLines, orderRefunds, orders } from '@nuxflow/db/schema'
import { fromMinorUnits } from '../../shared/lib/money'
import { useDb, type Db } from './db'
import { requireSiteId } from './site-context'
import { getStripeProvider } from './payments/resolve'

/**
 * Orders: one record of everything a site sells for money (see the `orders` table). Bookings,
 * class passes and one-time membership tiers make one before sending the visitor to Stripe,
 * and the webhook marks it paid. The one refund function, `refundPayment()`, is here too.
 */

export type OrderRow = typeof orders.$inferSelect
export type OrderLineRow = typeof orderLines.$inferSelect
export type OrderRefundRow = typeof orderRefunds.$inferSelect
export type OrderStatus = OrderRow['status']
export type OrderLineKind = OrderLineRow['kind']

/** What Stripe Checkout objects carry in `metadata.nuxflowKind`. */
export type NuxflowKind = 'booking' | 'pass' | 'tier' | 'order' | 'appointment'

/** The statuses of an order that has been paid, whatever has been refunded since. */
export const PAID_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const satisfies readonly OrderStatus[]

/** First order number on a site. */
const FIRST_ORDER_NUMBER = 1001

export interface NewOrderLine {
  kind: OrderLineKind
  refId?: string | null
  recordId?: string | null
  name: string
  description?: string | null
  quantity: number
  unitMinor: number
  /** Product lines: the product's content item, and whether it's downloaded. */
  productId?: string | null
  isDigital?: boolean
}

export interface NewOrder {
  email: string
  name?: string
  userId?: string | null
  currency: string
  lines: NewOrderLine[]
  /** 'paid' only for a payment that arrived with no order behind it (see booking-webhooks.ts). */
  status?: 'pending' | 'paid'
  /** Shop orders: when the stock kept for this checkout goes back. */
  holdExpiresAt?: string | null
  shippingMinor?: number
  termsAcceptedAt?: string | null
  stripeSessionId?: string | null
  stripePaymentIntentId?: string | null
  totalMinor?: number
}

/**
 * Makes an order and its lines. The number is the site's next one, worked out in the insert
 * itself; two orders made at the same moment can still collide on the unique index, so a
 * collision is retried.
 */
export async function createOrder(db: Db, siteId: string, input: NewOrder): Promise<OrderRow> {
  const currency = input.currency.toUpperCase()
  const subtotal = input.lines.reduce((sum, line) => sum + line.unitMinor * line.quantity, 0)
  const now = new Date().toISOString()
  const id = ulid()
  let order: OrderRow | undefined
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    try {
      [order] = await db.insert(orders).values({
        id,
        siteId,
        number: sql`(select coalesce(max(${orders.number}), ${FIRST_ORDER_NUMBER - 1}) + 1 from ${orders} where ${orders.siteId} = ${siteId})`,
        status: input.status ?? 'pending',
        email: input.email,
        name: (input.name ?? '').slice(0, 100),
        userId: input.userId ?? null,
        currency,
        subtotalMinor: subtotal,
        totalMinor: input.totalMinor ?? subtotal,
        stripeSessionId: input.stripeSessionId ?? null,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        paidAt: input.status === 'paid' ? now : null,
        holdExpiresAt: input.holdExpiresAt ?? null,
        shippingMinor: input.shippingMinor ?? 0,
        termsAcceptedAt: input.termsAcceptedAt ?? null,
      }).returning()
    }
    catch (err) {
      if (attempt === 4 || !/UNIQUE/i.test(String((err as { cause?: unknown })?.cause ?? err))) throw err
    }
  }
  if (input.lines.length) {
    await db.insert(orderLines).values(input.lines.map((line, i) => ({
      id: ulid(),
      orderId: id,
      siteId,
      kind: line.kind,
      refId: line.refId ?? null,
      recordId: line.recordId ?? null,
      name: line.name.slice(0, 200),
      description: line.description?.slice(0, 500) ?? null,
      quantity: line.quantity,
      unitMinor: line.unitMinor,
      totalMinor: line.unitMinor * line.quantity,
      sortOrder: i,
      productId: line.productId ?? null,
      isDigital: line.isDigital ?? false,
    })))
  }
  return order!
}

/** The checkout opened for a pending order. */
export async function attachCheckoutSession(db: Db, siteId: string, orderId: string, sessionId: string): Promise<void> {
  await db.update(orders).set({ stripeSessionId: sessionId, updatedAt: new Date().toISOString() })
    .where(and(eq(orders.id, orderId), eq(orders.siteId, siteId)))
}

/** An order whose checkout never opened (the provider refused or was unreachable). */
export async function discardOrder(db: Db, siteId: string, orderId: string): Promise<void> {
  await db.delete(orders).where(and(eq(orders.id, orderId), eq(orders.siteId, siteId), inArray(orders.status, ['pending', 'cancelled'])))
}

/**
 * Opens a checkout for a new pending order, tidying the order away if the provider fails.
 * `open` gets the order (for its id, which goes into the checkout's metadata) and returns the
 * session; its errors are passed on unchanged for the caller's own message.
 */
export async function withPendingOrder<T extends { id: string }>(event: H3Event, input: NewOrder, open: (order: OrderRow) => Promise<T>): Promise<T> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const order = await createOrder(db, siteId, input)
  try {
    const session = await open(order)
    await attachCheckoutSession(db, siteId, order.id, session.id)
    return session
  }
  catch (err) {
    await discardOrder(db, siteId, order.id).catch(() => null)
    throw err
  }
}

/** The order a checkout belongs to: by the id it carries, else by the session. */
export async function findOrderForSession(db: Db, siteId: string, session: { id: string; metadata?: Record<string, string> | null }): Promise<OrderRow | null> {
  const orderId = session.metadata?.orderId
  if (orderId) {
    const byId = await db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.siteId, siteId)) })
    if (byId) return byId
  }
  return await db.query.orders.findFirst({ where: and(eq(orders.siteId, siteId), eq(orders.stripeSessionId, session.id)) }) ?? null
}

export interface PaidSession {
  id: string
  paymentIntentId: string | null
  totalMinor: number
  taxMinor?: number
  shippingMinor?: number
  discountMinor?: number
  email?: string | null
  name?: string | null
}

/**
 * Marks an order paid with what the provider actually took. Safe to run twice: only the
 * first call changes anything, and `newlyPaid` says which call that was. A checkout that
 * expired and was then paid after all (Stripe can complete a session right at its end) is
 * paid too.
 */
export async function markOrderPaid(db: Db, siteId: string, order: OrderRow, paid: PaidSession): Promise<{ order: OrderRow; newlyPaid: boolean }> {
  const now = new Date().toISOString()
  const [updated] = await db.update(orders)
    .set({
      status: 'paid',
      paidAt: now,
      stripeSessionId: paid.id,
      stripePaymentIntentId: paid.paymentIntentId,
      totalMinor: paid.totalMinor,
      taxMinor: paid.taxMinor ?? 0,
      shippingMinor: paid.shippingMinor ?? 0,
      discountMinor: paid.discountMinor ?? 0,
      ...(paid.name && !order.name ? { name: paid.name.slice(0, 100) } : {}),
      updatedAt: now,
    })
    .where(and(eq(orders.id, order.id), eq(orders.siteId, siteId), inArray(orders.status, ['pending', 'expired', 'cancelled'])))
    .returning()
  return updated ? { order: updated, newlyPaid: true } : { order, newlyPaid: false }
}

/** A checkout closed unpaid. Only a still-pending order for that very session changes. */
export async function markOrderExpired(db: Db, siteId: string, sessionId: string): Promise<OrderRow | null> {
  const [expired] = await db.update(orders)
    .set({ status: 'expired', updatedAt: new Date().toISOString() })
    .where(and(eq(orders.siteId, siteId), eq(orders.stripeSessionId, sessionId), eq(orders.status, 'pending')))
    .returning()
  return expired ?? null
}

/** Records what buying a line made (the holding, the subscription) once it exists. */
export async function setLineRecord(db: Db, siteId: string, orderId: string, kind: OrderLineKind, recordId: string): Promise<void> {
  await db.update(orderLines).set({ recordId })
    .where(and(eq(orderLines.orderId, orderId), eq(orderLines.siteId, siteId), eq(orderLines.kind, kind)))
}

export async function getOrderLines(db: Db, siteId: string, orderId: string): Promise<OrderLineRow[]> {
  return db.query.orderLines.findMany({
    where: and(eq(orderLines.orderId, orderId), eq(orderLines.siteId, siteId)),
    orderBy: (l, { asc }) => [asc(l.sortOrder)],
  })
}

export async function findOrderByPaymentIntent(db: Db, siteId: string, paymentIntentId: string): Promise<OrderRow | null> {
  return await db.query.orders.findFirst({ where: and(eq(orders.siteId, siteId), eq(orders.stripePaymentIntentId, paymentIntentId)) }) ?? null
}

// ── Refunds ─────────────────────────────────────────────────────────────────

/**
 * Brings `refunded_minor` and the status up to date in one statement: the larger of the sum
 * of our own refunds and the total Stripe last reported (which includes ours, plus any made
 * in its dashboard). Taking the larger means it doesn't matter which arrives first.
 */
export async function recomputeRefunded(db: Db, siteId: string, orderId: string): Promise<void> {
  const ours = sql`coalesce((select sum(${orderRefunds.amountMinor}) from ${orderRefunds} where ${orderRefunds.orderId} = ${orders.id} and ${orderRefunds.siteId} = ${siteId}), 0)`
  const refunded = sql`max(${orders.stripeRefundedMinor}, ${ours})`
  await db.update(orders)
    .set({
      refundedMinor: refunded,
      status: sql`case when ${orders.status} in ('paid', 'partially_refunded', 'refunded') then
        case when ${refunded} >= ${orders.totalMinor} and ${orders.totalMinor} > 0 then 'refunded'
             when ${refunded} > 0 then 'partially_refunded'
             else 'paid' end
        else ${orders.status} end`,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(orders.id, orderId), eq(orders.siteId, siteId)))
}

/** What Stripe says has been refunded on a payment, from its `charge.refunded` webhook. */
export async function recordStripeRefundTotal(db: Db, siteId: string, paymentIntentId: string, refundedMinor: number): Promise<OrderRow | null> {
  const order = await findOrderByPaymentIntent(db, siteId, paymentIntentId)
  if (!order) return null
  await db.update(orders)
    .set({ stripeRefundedMinor: sql`max(${orders.stripeRefundedMinor}, ${refundedMinor})` })
    .where(and(eq(orders.id, order.id), eq(orders.siteId, siteId)))
  await recomputeRefunded(db, siteId, order.id)
  return await db.query.orders.findFirst({ where: and(eq(orders.id, order.id), eq(orders.siteId, siteId)) }) ?? null
}

export interface RefundRequest {
  paymentIntentId: string
  /** Part of the payment, in minor units. Omit for the whole of what's left. */
  amountMinor?: number
  currency?: string
  /** A retry or a double click with the same key refunds once, not twice. */
  idempotencyKey: string
  reason?: string
  createdBy?: string | null
}

/**
 * The one way NuxFlow gives money back, for bookings, passes, tiers and shop orders alike.
 * Throws whatever the provider throws, before anything is recorded, so callers can leave
 * their own records as they were and say why. Once the money has moved, recording it never
 * fails the call.
 */
export async function refundPayment(event: H3Event, req: RefundRequest): Promise<{ id: string; amount?: number | null }> {
  const stripe = await getStripeProvider(event)
  const partial = req.amountMinor !== undefined && req.currency
  const refund = await stripe.refundPayment({
    paymentIntentId: req.paymentIntentId,
    ...(partial ? { amount: fromMinorUnits(req.amountMinor!, req.currency!), currency: req.currency } : {}),
    idempotencyKey: req.idempotencyKey,
  }) as { id?: string; amount?: number | null }

  try {
    const db = useDb(event)
    const siteId = requireSiteId(event)
    const order = await findOrderByPaymentIntent(db, siteId, req.paymentIntentId)
    if (order) {
      const amount = typeof refund.amount === 'number'
        ? refund.amount
        : req.amountMinor ?? Math.max(0, order.totalMinor - order.refundedMinor)
      await db.insert(orderRefunds).values({
        id: ulid(),
        orderId: order.id,
        siteId,
        amountMinor: amount,
        reason: req.reason?.slice(0, 500) ?? null,
        stripeRefundId: refund.id ?? req.idempotencyKey,
        createdBy: req.createdBy ?? null,
      }).onConflictDoNothing()
      await recomputeRefunded(db, siteId, order.id)
    }
  }
  catch (err) {
    console.error('[orders] Refund made but not recorded:', err)
  }
  return { id: refund.id ?? req.idempotencyKey, amount: refund.amount }
}
