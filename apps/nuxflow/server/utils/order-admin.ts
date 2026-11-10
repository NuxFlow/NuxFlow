import type { H3Event } from 'h3'
import { and, desc, eq, inArray, like, or, sql, type SQL } from 'drizzle-orm'
import { orderLines, orderRefunds, orders } from '@nuxflow/db/schema'
import { useDb } from './db'
import { requireSiteId } from './site-context'
import { applyRefundToRecords } from './booking-webhooks'
import { getOrderLines, PAID_STATUSES, refundPayment, type OrderLineKind, type OrderRow, type OrderStatus } from './orders'

/** Admin → Orders: the list, one order, and refunds from there. */

export type OrderFilter = 'sales' | 'all' | OrderStatus

export interface OrderListQuery {
  filter: OrderFilter
  kind?: OrderLineKind
  search?: string
  limit: number
  offset: number
}

export async function listOrders(event: H3Event, q: OrderListQuery) {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const conditions: (SQL | undefined)[] = [eq(orders.siteId, siteId)]
  if (q.filter === 'sales') conditions.push(inArray(orders.status, [...PAID_STATUSES]))
  else if (q.filter !== 'all') conditions.push(eq(orders.status, q.filter))
  if (q.kind) {
    conditions.push(sql`exists (select 1 from ${orderLines} where ${orderLines.orderId} = ${orders.id} and ${orderLines.siteId} = ${siteId} and ${orderLines.kind} = ${q.kind})`)
  }
  const term = q.search?.replace(/[%_]/g, '').trim()
  if (term) {
    const asNumber = /^#?\d+$/.test(term) ? Number(term.replace('#', '')) : null
    conditions.push(or(like(orders.email, `%${term}%`), like(orders.name, `%${term}%`), asNumber !== null ? eq(orders.number, asNumber) : undefined))
  }
  const where = and(...conditions)
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.select().from(orders).where(where).orderBy(desc(orders.createdAt), desc(orders.id)).limit(q.limit).offset(q.offset),
    db.select({ total: sql<number>`count(*)` }).from(orders).where(where),
  ])
  const lines = rows.length
    ? await db.select({ orderId: orderLines.orderId, kind: orderLines.kind, name: orderLines.name, quantity: orderLines.quantity })
        .from(orderLines)
        .where(and(eq(orderLines.siteId, siteId), inArray(orderLines.orderId, rows.map(r => r.id))))
        .orderBy(orderLines.sortOrder)
    : []
  return {
    total: Number(total),
    orders: rows.map(order => ({
      ...order,
      lines: lines.filter(l => l.orderId === order.id).map(({ kind, name, quantity }) => ({ kind, name, quantity })),
    })),
  }
}

export async function getOrderDetail(event: H3Event, id: string) {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, id), eq(orders.siteId, siteId)) })
  if (!order) notFound('That order was not found.')
  const [lines, refunds] = await Promise.all([
    getOrderLines(db, siteId, id),
    db.query.orderRefunds.findMany({
      where: and(eq(orderRefunds.orderId, id), eq(orderRefunds.siteId, siteId)),
      orderBy: (r, { asc }) => [asc(r.createdAt)],
    }),
  ])
  const ours = refunds.reduce((sum, r) => sum + r.amountMinor, 0)
  // Refunded in Stripe's dashboard, so there's no row of ours for it.
  const refundedElsewhereMinor = Math.max(0, order.refundedMinor - ours)
  return { order, lines, refunds, refundedElsewhereMinor }
}

/** What a full refund of this order ends, for the warning beside the button. */
export function refundConsequences(lines: { kind: OrderLineKind }[]): string[] {
  const kinds = new Set(lines.map(l => l.kind))
  const notes: string[] = []
  if (kinds.has('booking')) notes.push('A full refund cancels the booking and frees the place.')
  if (kinds.has('pass')) notes.push('A full refund stops the class pass, so no more credits can be spent.')
  if (kinds.has('tier')) notes.push('A full refund ends the membership access it bought.')
  return notes
}

/**
 * A refund from the Orders page, of the whole of what's left or part of it. What the order
 * bought follows, exactly as for a refund made in Stripe's dashboard.
 */
export async function refundOrder(event: H3Event, id: string, opts: { amountMinor?: number; reason?: string; userId: string }): Promise<OrderRow> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, id), eq(orders.siteId, siteId)) })
  if (!order) notFound('That order was not found.')
  if (order.status !== 'paid' && order.status !== 'partially_refunded') conflict('Only a paid order can be refunded.')
  if (!order.stripePaymentIntentId) conflict('This order has no card payment to refund.')
  const left = order.totalMinor - order.refundedMinor
  if (left <= 0) conflict('This order has already been refunded in full.')
  const amount = opts.amountMinor ?? left
  if (amount <= 0 || amount > left) validationError('The refund can\'t be more than what\'s left of the payment.')

  try {
    await refundPayment(event, {
      paymentIntentId: order.stripePaymentIntentId,
      amountMinor: amount,
      currency: order.currency,
      // The amount already refunded is in the key, so a second, separate partial refund of the
      // same amount isn't mistaken for a double click on the first.
      idempotencyKey: `order-refund-${order.id}-${order.refundedMinor}-${amount}`,
      reason: opts.reason || undefined,
      createdBy: opts.userId,
    })
  }
  catch (err) {
    console.error('[orders] Refund failed:', err)
    httpError({ status: 502, message: err instanceof Error ? `Stripe refused the refund: ${err.message}` : 'Stripe refused the refund.' })
  }
  const after = await db.query.orders.findFirst({ where: and(eq(orders.id, id), eq(orders.siteId, siteId)) })
  const refundedMinor = Math.max(after?.refundedMinor ?? 0, order.refundedMinor + amount)
  await applyRefundToRecords(event, order.stripePaymentIntentId, { refundedMinor, paymentMinor: order.totalMinor, currency: order.currency })
  return after ?? order
}
