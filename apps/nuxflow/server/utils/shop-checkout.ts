import type { H3Event } from 'h3'
import { and, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { contentItems, contentTypes, orderLines, orders, productVariants } from '@nuxflow/db/schema'
import { basketTotals, MAX_BASKET_LINES, MAX_LINE_QUANTITY, variantLabel, type ShopSettings } from '../../shared/lib/shop'
import { formatMoney } from '../../shared/lib/money'
import { useDb, type Db } from './db'
import { requireSiteId } from './site-context'
import { getShopSettings } from './shop'
import { getStripeProvider } from './payments/resolve'
import { bookingOrigin, bookingPaymentsReady } from './class-passes'
import { normalizeEmail } from './mailing-list'
import { hmacSha256Hex, constantTimeEqualHex } from './webhook-crypto'
import { absoluteUrl } from './media-url'
import { publicPathForItem } from './seo'
import { sendTemplatedEmail } from './email-template'
import { notifySiteRole } from './notify'
import { waitUntil } from './cf-env'
import { getSiteInfo } from './site-info'
import { purgeContentCache } from './edge-cache'
import { createOrder, discardOrder, findOrderForSession, getOrderLines, markOrderExpired, markOrderPaid, refundPayment, type OrderLineRow, type OrderRow } from './orders'
import type { StripeCheckoutSession } from './booking-webhooks'
import { downloadLink, downloadState } from './shop-downloads'
import { getBusinessInfo } from './business'
import { collectionDays, formatCollectAt, isCollectionChoice, type CollectionDay } from '../../shared/lib/shop-collection'

/**
 * The shop's basket and checkout. The basket lives in the visitor's browser (a cookie would
 * switch the page cache off); here every price and stock level is checked again, stock is
 * taken for the order while they pay at Stripe — in one conditional statement per line, so
 * two people can't buy the last one — and given back if they don't. A payment that arrives
 * after its stock went back gets it again if it's still there, and is refunded if not: the
 * same pattern as class bookings' held places.
 */

/** How long a visitor has at Stripe. Its minimum is 30 minutes. */
const CHECKOUT_MINUTES = 31

/** Stock is kept a little past the checkout's end, so a last-second payment always has it. */
const HOLD_MS = (CHECKOUT_MINUTES + 5) * 60_000

/** Most lapsed orders the sweep handles a minute (it runs every minute). */
const SWEEP_BATCH = 100

export interface BasketRequestLine {
  variantId: string
  quantity: number
}

export interface PricedLine {
  variantId: string
  productId: string
  title: string
  label: string
  path: string
  image: string | null
  unitMinor: number
  quantity: number
  isDigital: boolean
  /** Null: not tracked. */
  stock: number | null
  /** Why it can't be bought as asked, in words fit to show; null when it can. */
  problem: string | null
}

/**
 * Prices a basket from the database, never from what the browser says. Lines for products
 * that are gone, unpublished or off sale come back with a problem rather than an error, so
 * the basket page can say which and let the visitor carry on with the rest.
 */
export async function priceBasket(db: Db, siteId: string, lines: readonly BasketRequestLine[], locale: string): Promise<PricedLine[]> {
  const ids = [...new Set(lines.map(l => l.variantId))]
  if (!ids.length) return []
  const productType = await db.query.contentTypes.findFirst({ where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'product')), columns: { id: true } })
  const rows = productType
    ? await db.select({
        variantId: productVariants.id,
        options: productVariants.options,
        priceMinor: productVariants.priceMinor,
        stock: productVariants.stock,
        kind: productVariants.kind,
        isActive: productVariants.isActive,
        imageUrl: productVariants.imageUrl,
        fileKey: productVariants.fileKey,
        productId: contentItems.id,
        title: contentItems.title,
        slug: contentItems.slug,
        ogImage: contentItems.ogImage,
        status: contentItems.status,
        visibility: contentItems.visibility,
      })
        .from(productVariants)
        .innerJoin(contentItems, and(eq(contentItems.id, productVariants.contentItemId), eq(contentItems.siteId, siteId), eq(contentItems.typeId, productType.id)))
        .where(and(eq(productVariants.siteId, siteId), inArray(productVariants.id, ids)))
    : []

  return lines.map((line) => {
    const row = rows.find(r => r.variantId === line.variantId)
    const quantity = Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.floor(line.quantity)))
    if (!row) {
      return { variantId: line.variantId, productId: '', title: 'This item', label: '', path: '/', image: null, unitMinor: 0, quantity, isDigital: false, stock: 0, problem: 'This isn\'t on sale any more.' }
    }
    const isDigital = row.kind === 'digital'
    let problem: string | null = null
    if (row.status !== 'published' || row.visibility !== 'public' || !row.isActive) problem = 'This isn\'t on sale any more.'
    else if (isDigital && !row.fileKey) problem = 'This download isn\'t ready yet.'
    else if (!isDigital && row.stock !== null && row.stock < quantity) problem = row.stock <= 0 ? 'Sold out.' : `Only ${row.stock} left.`
    return {
      variantId: row.variantId,
      productId: row.productId,
      title: row.title,
      label: variantLabel(row.options),
      path: publicPathForItem({ slug: row.slug }, locale),
      image: row.imageUrl || row.ogImage || null,
      unitMinor: row.priceMinor,
      quantity,
      isDigital,
      // Downloads never run out.
      stock: isDigital ? null : row.stock,
      problem,
    }
  })
}

export interface BasketQuote {
  lines: (Omit<PricedLine, 'stock'> & { unit: string; total: string })[]
  subtotal: string
  shipping: string | null
  subtotalMinor: number
  shippingMinor: number
  currency: string
  pricesIncludeTax: boolean
  /** Tax is added at checkout (Stripe Tax on, prices without it). */
  taxAtCheckout: boolean
  /** Something has to be posted and the shop neither posts it nor offers collection. */
  cannotShip: boolean
  /** The shop posts somewhere (delivery can be chosen for posted goods). */
  canDeliver: boolean
  /** Click and collect, when it's on and something in the basket isn't a download. */
  collection: { label: string; instructions: string; days: CollectionDay[] } | null
  /** The returns-policy page to agree to, when the shop has one. */
  returnsPath: string | null
  paymentsReady: boolean
}

function shippingSettings(shop: ShopSettings) {
  return { shippingRateMinor: shop.shippingRateMinor, freeShippingOverMinor: shop.freeShippingOverMinor }
}

/** What the basket page shows: today's prices, problems per line, and the totals before tax. */
export async function quoteBasket(event: H3Event, lines: readonly BasketRequestLine[]): Promise<BasketQuote> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const [shop, site, paymentsReady] = await Promise.all([getShopSettings(event), getSiteInfo(event, siteId), bookingPaymentsReady(event)])
  const locale = site?.locale || 'en'
  const priced = await priceBasket(db, siteId, lines.slice(0, MAX_BASKET_LINES), locale)
  const sellable = priced.filter(l => !l.problem)
  const totals = basketTotals(sellable, shippingSettings(shop))
  const money = (minor: number) => formatMoney(minor, shop.currency, locale)
  return {
    // Without the stock count: visitors are only told how many are left when few are.
    lines: priced.map(({ stock: _stock, ...l }) => ({ ...l, unit: money(l.unitMinor), total: money(l.unitMinor * l.quantity) })),
    subtotal: money(totals.subtotalMinor),
    shipping: totals.needsShipping ? (totals.shippingMinor ? money(totals.shippingMinor) : 'Free') : null,
    subtotalMinor: totals.subtotalMinor,
    shippingMinor: totals.shippingMinor,
    currency: shop.currency,
    pricesIncludeTax: shop.pricesIncludeTax,
    taxAtCheckout: shop.stripeTax && !shop.pricesIncludeTax,
    cannotShip: totals.needsShipping && shop.shippingCountries.length === 0 && !shop.collectionEnabled,
    canDeliver: shop.shippingCountries.length > 0,
    collection: totals.needsShipping && shop.collectionEnabled
      ? { label: shop.collectionLabel, instructions: shop.collectionInstructions, days: await collectionChoices(event, shop, locale) }
      : null,
    returnsPath: shop.returnsPage ? publicPathForItem({ slug: shop.returnsPage }, locale) : null,
    paymentsReady,
  }
}

// ── Taking stock and giving it back ─────────────────────────────────────────

/**
 * Takes a line's quantity from its variant's stock, only if that much is there. Untracked
 * stock (null) and downloads take nothing. Returns whether the line has what it needs.
 */
async function takeLineStock(db: Db, siteId: string, line: Pick<OrderLineRow, 'id' | 'refId' | 'quantity' | 'isDigital' | 'stockTaken'>): Promise<boolean> {
  if (line.isDigital || line.stockTaken > 0 || !line.refId) return true
  const variant = await db.query.productVariants.findFirst({ where: and(eq(productVariants.id, line.refId), eq(productVariants.siteId, siteId)), columns: { stock: true } })
  if (!variant) return false
  if (variant.stock === null) return true
  const [taken] = await db.update(productVariants)
    .set({ stock: sql`${productVariants.stock} - ${line.quantity}`, updatedAt: new Date().toISOString() })
    .where(and(eq(productVariants.id, line.refId), eq(productVariants.siteId, siteId), isNotNull(productVariants.stock), sql`${productVariants.stock} >= ${line.quantity}`))
    .returning({ id: productVariants.id })
  if (!taken) return false
  await db.update(orderLines).set({ stockTaken: line.quantity }).where(and(eq(orderLines.id, line.id), eq(orderLines.siteId, siteId)))
  return true
}

/**
 * Gives an unpaid order's stock back. Each line is claimed in one statement that also checks
 * the order still isn't paid, so a payment landing at the same moment keeps its stock.
 * `paidToo` is for a paid order being refunded because part of it couldn't be had.
 */
export async function releaseOrderStock(db: Db, siteId: string, orderId: string, opts: { paidToo?: boolean } = {}): Promise<void> {
  const lines = await db.query.orderLines.findMany({ where: and(eq(orderLines.orderId, orderId), eq(orderLines.siteId, siteId), gt(orderLines.stockTaken, 0)) })
  for (const line of lines) {
    const [claimed] = await db.update(orderLines)
      .set({ stockTaken: 0 })
      .where(and(
        eq(orderLines.id, line.id),
        eq(orderLines.siteId, siteId),
        eq(orderLines.stockTaken, line.stockTaken),
        opts.paidToo ? undefined : sql`(select ${orders.status} from ${orders} where ${orders.id} = ${orderLines.orderId} and ${orders.siteId} = ${siteId}) in ('pending', 'expired', 'cancelled')`,
      ))
      .returning({ id: orderLines.id })
    if (!claimed || !line.refId) continue
    await db.update(productVariants)
      .set({ stock: sql`${productVariants.stock} + ${line.stockTaken}`, updatedAt: new Date().toISOString() })
      .where(and(eq(productVariants.id, line.refId), eq(productVariants.siteId, siteId), isNotNull(productVariants.stock)))
  }
}

// ── Checkout ────────────────────────────────────────────────────────────────

export interface CheckoutRequest {
  lines: BasketRequestLine[]
  email?: string
  acceptedTerms: boolean
  /** This browser's last checkout, which a new one replaces (it came back without paying). */
  previous?: { orderId: string; token: string }
  /** Posted goods: sent, or collected at `collectAt` (one of collectionChoices()). */
  fulfilment?: 'delivery' | 'collect'
  collectAt?: string
}

/** The days and times this shop's orders can be collected, from now. */
export async function collectionChoices(event: H3Event, shop: ShopSettings, locale: string): Promise<CollectionDay[]> {
  const site = await getSiteInfo(event, requireSiteId(event))
  return collectionDays({
    info: await getBusinessInfo(event),
    timeZone: site?.timezone || 'UTC',
    leadMinutes: shop.collectionLeadMinutes,
    days: shop.collectionDays,
    now: new Date(),
    locale,
  })
}

/**
 * Someone back from Stripe without paying who presses Pay again: their earlier checkout is
 * closed and its stock let go first, so they aren't competing with their own basket. If the
 * earlier one was paid after all, its webhook is on the way, and a second order is refused.
 */
async function replacePreviousCheckout(event: H3Event, previous: { orderId: string; token: string }): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  if (!(await verifyOrderToken(siteId, previous.orderId, previous.token))) return
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, previous.orderId), eq(orders.siteId, siteId)) })
  if (!order || order.status !== 'pending') return
  if (order.stripeSessionId) {
    const stripe = await getStripeProvider(event)
    const session = await stripe.getCheckoutSession(order.stripeSessionId).catch(() => null)
    if (session?.status === 'complete') conflict('Your earlier payment for this basket went through. Check your email for the receipt.', { code: 'already_paid' })
    if (session?.status === 'open') await stripe.expireCheckoutSession(session.id).catch(() => null)
  }
  const expired = await db.update(orders).set({ status: 'expired', updatedAt: new Date().toISOString() })
    .where(and(eq(orders.id, order.id), eq(orders.siteId, siteId), eq(orders.status, 'pending')))
    .returning({ id: orders.id })
  if (expired.length) await releaseOrderStock(db, siteId, order.id)
}

/**
 * Starts paying for a basket: a pending order with the stock taken, then Stripe Checkout.
 * Refuses (409, naming the line) rather than quietly dropping something that has sold out
 * since the basket page was loaded.
 */
export async function startShopCheckout(event: H3Event, input: CheckoutRequest): Promise<{ url: string; orderId: string; token: string }> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const [shop, site] = await Promise.all([getShopSettings(event), getSiteInfo(event, siteId)])
  if (!(await bookingPaymentsReady(event))) httpError({ status: 503, message: 'Online payments aren\'t available right now.' })
  if (input.previous) await replacePreviousCheckout(event, input.previous)
  const locale = site?.locale || 'en'

  const merged = new Map<string, number>()
  for (const l of input.lines) merged.set(l.variantId, Math.min(MAX_LINE_QUANTITY, (merged.get(l.variantId) ?? 0) + l.quantity))
  const priced = await priceBasket(db, siteId, [...merged].map(([variantId, quantity]) => ({ variantId, quantity })), locale)
  if (!priced.length) validationError('Your basket is empty.')
  const problem = priced.find(l => l.problem)
  if (problem) conflict(`${problem.title}${problem.label ? ` (${problem.label})` : ''}: ${problem.problem}`, { variantId: problem.variantId })

  const delivered = basketTotals(priced, shippingSettings(shop))
  // Click and collect: free, with a time that's still on offer now (the basket page may be old).
  const collecting = delivered.needsShipping && input.fulfilment === 'collect'
  if (collecting) {
    if (!shop.collectionEnabled) conflict('This shop isn\'t offering collection at the moment.')
    const days = await collectionChoices(event, shop, locale)
    if (!input.collectAt || !isCollectionChoice(days, input.collectAt)) conflict('That collection time isn\'t available any more. Please choose another.')
  }
  else if (delivered.needsShipping && !shop.shippingCountries.length) {
    conflict(shop.collectionEnabled ? 'Please choose a time to collect your order.' : 'This shop isn\'t posting anything at the moment.')
  }
  const totals = collecting ? { ...delivered, shippingMinor: 0 } : delivered
  if (shop.returnsPage && !input.acceptedTerms) validationError('Please confirm you\'ve read the returns policy.')

  const now = new Date()
  const email = input.email ? normalizeEmail(input.email) : ''
  const order = await createOrder(db, siteId, {
    email,
    currency: shop.currency,
    lines: priced.map(l => ({
      kind: 'product',
      refId: l.variantId,
      productId: l.productId,
      isDigital: l.isDigital,
      name: l.title,
      description: l.label || null,
      quantity: l.quantity,
      unitMinor: l.unitMinor,
    })),
    totalMinor: totals.subtotalMinor + totals.shippingMinor,
    shippingMinor: totals.shippingMinor,
    holdExpiresAt: new Date(now.getTime() + HOLD_MS).toISOString(),
    termsAcceptedAt: input.acceptedTerms ? now.toISOString() : null,
  })

  if (collecting) {
    await db.update(orders).set({ fulfilment: 'collect', collectAt: input.collectAt!, updatedAt: new Date().toISOString() })
      .where(and(eq(orders.id, order.id), eq(orders.siteId, siteId)))
  }

  const lines = await getOrderLines(db, siteId, order.id)
  for (const line of lines) {
    if (await takeLineStock(db, siteId, line)) continue
    // Someone else got the last one between pricing and here.
    await db.update(orders).set({ status: 'cancelled', updatedAt: new Date().toISOString() }).where(and(eq(orders.id, order.id), eq(orders.siteId, siteId)))
    await releaseOrderStock(db, siteId, order.id)
    await discardOrder(db, siteId, order.id).catch(() => null)
    conflict(`${line.name}${line.description ? ` (${line.description})` : ''}: sold out while you were looking.`, { variantId: line.refId })
  }

  const origin = bookingOrigin(event)
  const token = await orderToken(siteId, order.id)
  try {
    const stripe = await getStripeProvider(event)
    const session = await stripe.createOrderCheckout({
      customerEmail: email || undefined,
      currency: shop.currency,
      lines: priced.map(l => {
        const image = l.image ? absoluteUrl(l.image, origin) : null
        return { name: l.title, description: l.label || undefined, image: image && /^https:\/\//.test(image) ? image : undefined, unitMinor: l.unitMinor, quantity: l.quantity }
      }),
      // Collected orders aren't posted, so Stripe asks for no address.
      shipping: totals.needsShipping && !collecting ? { countries: shop.shippingCountries, label: shop.shippingLabel, amountMinor: totals.shippingMinor } : null,
      automaticTax: shop.stripeTax,
      pricesIncludeTax: shop.pricesIncludeTax,
      successUrl: `${origin}/checkout/thanks?${new URLSearchParams({ order: order.id, token })}`,
      cancelUrl: `${origin}/checkout`,
      metadata: { nuxflowKind: 'order', siteId, orderId: order.id },
      expiresInMinutes: CHECKOUT_MINUTES,
    })
    if (!session.url) throw new Error('Stripe returned no checkout address')
    await db.update(orders).set({ stripeSessionId: session.id, updatedAt: new Date().toISOString() }).where(and(eq(orders.id, order.id), eq(orders.siteId, siteId)))
    return { url: session.url, orderId: order.id, token }
  }
  catch (err) {
    console.error('[shop] Checkout failed:', err)
    await db.update(orders).set({ status: 'cancelled', updatedAt: new Date().toISOString() }).where(and(eq(orders.id, order.id), eq(orders.siteId, siteId)))
    await releaseOrderStock(db, siteId, order.id)
    await discardOrder(db, siteId, order.id).catch(() => null)
    httpError({ status: 502, message: 'We couldn\'t reach the payment provider. Please try again in a few minutes.' })
  }
}

// ── After Stripe ────────────────────────────────────────────────────────────

interface StripeShopSession extends StripeCheckoutSession {
  shipping_details?: { name?: string | null; phone?: string | null; address?: StripeAddress | null } | null
  collected_information?: { shipping_details?: { name?: string | null; address?: StripeAddress | null } | null } | null
}

interface StripeAddress { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null }

function shippingFrom(session: StripeShopSession): OrderRow['shippingAddress'] {
  // Newer API versions put it under collected_information; older ones at the top.
  const details = session.collected_information?.shipping_details ?? session.shipping_details
  const a = details?.address
  if (!details || !a) return null
  const phone = (details as { phone?: string | null }).phone ?? session.customer_details?.phone ?? null
  return { name: details.name ?? null, phone, line1: a.line1 ?? null, line2: a.line2 ?? null, city: a.city ?? null, state: a.state ?? null, postalCode: a.postal_code ?? null, country: a.country ?? null }
}

/**
 * A shop checkout was paid. Safe to run twice. If the order's stock went back while they
 * were paying, it's taken again if it's still there; if not, they get their money back
 * straight away and are told.
 */
export async function settleShopOrder(event: H3Event, session: StripeShopSession): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const existing = await findOrderForSession(db, siteId, session)
  if (!existing) {
    console.warn(`[shop] Paid checkout ${session.id} has no order`)
    return
  }
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
  const { order, newlyPaid } = await markOrderPaid(db, siteId, existing, {
    id: session.id,
    paymentIntentId: intent,
    totalMinor: session.amount_total ?? existing.totalMinor,
    taxMinor: session.total_details?.amount_tax ?? 0,
    shippingMinor: session.total_details?.amount_shipping ?? existing.shippingMinor,
    discountMinor: session.total_details?.amount_discount ?? 0,
    name: session.customer_details?.name ?? null,
  })
  if (!newlyPaid) return

  const email = order.email || (session.customer_details?.email ? normalizeEmail(session.customer_details.email) : '')
  await db.update(orders)
    .set({ email, shippingAddress: shippingFrom(session), holdExpiresAt: null, updatedAt: new Date().toISOString() })
    .where(and(eq(orders.id, order.id), eq(orders.siteId, siteId)))

  const lines = await getOrderLines(db, siteId, order.id)
  let short = false
  for (const line of lines) {
    if (!(await takeLineStock(db, siteId, line))) {
      short = true
      break
    }
  }
  const paid = { ...order, email }
  if (short) {
    await refundUnfulfillable(event, paid)
    return
  }

  await sendOrderConfirmation(event, paid).catch(err => console.error('[shop] Order email failed:', err))
  notifyShopTeam(event, `New order #${order.number}`, `${order.name || email || 'Someone'} paid ${formatMoney(order.totalMinor, order.currency)}.`)
  await purgeSoldOut(event, db, siteId, lines)
}

/** Paid after its stock had gone back, and it's gone: every line goes back to stock, the money back to them. */
async function refundUnfulfillable(event: H3Event, order: OrderRow): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  // Whatever this attempt did manage to take goes back.
  await releaseOrderStock(db, siteId, order.id, { paidToo: true })
  if (order.stripePaymentIntentId) {
    await refundPayment(event, { paymentIntentId: order.stripePaymentIntentId, idempotencyKey: `order-nostock-${order.id}`, reason: 'Sold out before the payment arrived' })
  }
  if (order.email) {
    await sendTemplatedEmail(event, {
      to: order.email,
      subject: `Your order #${order.number} couldn't be completed`,
      category: 'shop_order',
      template: {
        heading: 'Sorry, it sold out',
        paragraphs: [
          'Your payment reached us after the last one had gone, so we couldn\'t send your order.',
          `We've refunded the full ${formatMoney(order.totalMinor, order.currency)} to the card you paid with. It usually shows within 5 to 10 working days.`,
        ],
      },
    }).catch(err => console.error('[shop] Refund email failed:', err))
  }
  notifyShopTeam(event, `Order #${order.number} refunded`, 'It was paid after its stock had gone, so the customer was refunded automatically.')
}

/** A product that just sold out: its cached page still says it's available. */
async function purgeSoldOut(event: H3Event, db: Db, siteId: string, lines: OrderLineRow[]): Promise<void> {
  const ids = lines.filter(l => l.stockTaken > 0 && l.refId).map(l => l.refId!)
  if (!ids.length) return
  const out = await db.select({ productId: productVariants.contentItemId }).from(productVariants)
    .where(and(eq(productVariants.siteId, siteId), inArray(productVariants.id, ids), eq(productVariants.stock, 0)))
  if (!out.length) return
  const items = await db.select({ slug: contentItems.slug }).from(contentItems)
    .where(and(eq(contentItems.siteId, siteId), inArray(contentItems.id, [...new Set(out.map(o => o.productId))])))
  await purgeContentCache(event, { published: true, slugs: items.map(i => i.slug) }).catch(err => console.error('[shop] Cache purge failed:', err))
}

/** A shop checkout closed unpaid: its stock goes back. */
export async function expireShopOrder(event: H3Event, session: StripeCheckoutSession): Promise<void> {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const expired = await markOrderExpired(db, siteId, session.id)
  if (expired) await releaseOrderStock(db, siteId, expired.id)
}

/**
 * The every-minute sweep, across every site: orders whose hold has run out without payment
 * (their expiry webhook may never have come) give their stock back.
 */
export async function releaseLapsedHolds(db: Db, now = new Date()): Promise<number> {
  const lapsed = await db.update(orders)
    .set({ status: 'expired', updatedAt: now.toISOString() })
    .where(inArray(orders.id, db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.status, 'pending'), isNotNull(orders.holdExpiresAt), lt(orders.holdExpiresAt, now.toISOString())))
      .limit(SWEEP_BATCH)))
    .returning({ id: orders.id, siteId: orders.siteId })
  for (const order of lapsed) await releaseOrderStock(db, order.siteId, order.id)
  return lapsed.length
}

// ── The customer's own view ─────────────────────────────────────────────────

function linkSecret(): string {
  const secret = useRuntimeConfig().betterAuthSecret as string | undefined
  if (!secret) throw new Error('betterAuthSecret is not configured')
  return secret
}

/** Proves a link to one order was sent by this site. Nothing is stored. */
export function orderToken(siteId: string, orderId: string): Promise<string> {
  return hmacSha256Hex(linkSecret(), `shop-order:${siteId}:${orderId}`)
}

export async function verifyOrderToken(siteId: string, orderId: string, token: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false
  return constantTimeEqualHex(await orderToken(siteId, orderId), token)
}

export async function orderLink(event: H3Event, order: Pick<OrderRow, 'id' | 'siteId'>): Promise<string> {
  return `${bookingOrigin(event)}/checkout/order?${new URLSearchParams({ order: order.id, token: await orderToken(order.siteId, order.id) })}`
}

function notifyShopTeam(event: H3Event, title: string, body: string): void {
  waitUntil(event, notifySiteRole(event, {
    siteId: requireSiteId(event),
    minRole: 'admin',
    type: 'shop.order',
    title,
    body,
    pushUrl: '/admin/orders',
  }).catch(err => console.error('[shop] Team notification failed:', err)))
}

/** The receipt's lines about collecting: when, and the shop's own instructions. */
async function collectionLines(event: H3Event, collectAt: string, locale: string): Promise<string[]> {
  const shop = await getShopSettings(event)
  return [
    `${shop.collectionLabel}: ${formatCollectAt(collectAt, locale)}`,
    ...(shop.collectionInstructions ? [shop.collectionInstructions] : []),
  ]
}

/** The receipt: what they bought, where it's going, and the link to their order and downloads. */
export async function sendOrderConfirmation(event: H3Event, order: OrderRow): Promise<void> {
  if (!order.email) return
  const db = useDb(event)
  const site = await getSiteInfo(event, order.siteId)
  const locale = site?.locale || 'en'
  const money = (minor: number) => formatMoney(minor, order.currency, locale)
  const lines = await getOrderLines(db, order.siteId, order.id)
  const fresh = await db.query.orders.findFirst({ where: and(eq(orders.id, order.id), eq(orders.siteId, order.siteId)) }) ?? order
  const address = fresh.shippingAddress
  const paragraphs = [
    'Thank you. Your payment has gone through, and this is your receipt.',
    ...lines.map(l => `${l.quantity} × ${l.name}${l.description ? ` (${l.description})` : ''}: ${money(l.totalMinor)}`),
    ...(fresh.shippingMinor ? [`Delivery: ${money(fresh.shippingMinor)}`] : []),
    ...(fresh.taxMinor ? [`Tax: ${money(fresh.taxMinor)}`] : []),
    `Total paid: ${money(fresh.totalMinor)}`,
    ...(address ? [`Posting to: ${[address.name, address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')}`] : []),
    ...(fresh.fulfilment === 'collect' && fresh.collectAt ? await collectionLines(event, fresh.collectAt, locale) : []),
  ]
  const hasDownloads = lines.some(l => l.isDigital)
  await sendTemplatedEmail(event, {
    to: order.email,
    subject: `Order #${order.number} confirmed`,
    category: 'shop_order',
    template: {
      preheader: `Your order from ${site?.name ?? 'us'} is confirmed.`,
      heading: `Order #${order.number}`,
      paragraphs,
      action: { label: hasDownloads ? 'View your order and downloads' : 'View your order', url: await orderLink(event, order) },
      footnote: 'Keep this email: the button is how you get back to your order.',
    },
  })
}

/**
 * What the signed order link shows its customer: the order, where it's going, and a download
 * link for each digital line once paid. Null for a wrong token or an unknown order.
 */
export async function customerOrderView(event: H3Event, orderId: string, token: string) {
  const db = useDb(event)
  const siteId = requireSiteId(event)
  if (!(await verifyOrderToken(siteId, orderId, token))) return null
  const order = await db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.siteId, siteId)) })
  if (!order) return null
  const [lines, shop, site] = await Promise.all([getOrderLines(db, siteId, orderId), getShopSettings(event), getSiteInfo(event, siteId)])
  const locale = site?.locale || 'en'
  const money = (minor: number) => formatMoney(minor, order.currency, locale)
  const paid = (order.status === 'paid' || order.status === 'partially_refunded') && Boolean(order.paidAt)
  return {
    number: order.number,
    status: order.status,
    email: order.email,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    subtotal: money(order.subtotalMinor),
    shipping: order.shippingMinor ? money(order.shippingMinor) : null,
    tax: order.taxMinor ? money(order.taxMinor) : null,
    total: money(order.totalMinor),
    refunded: order.refundedMinor ? money(order.refundedMinor) : null,
    shippingAddress: order.shippingAddress,
    // Click and collect: when, and where/how (the shop's own words).
    collection: order.fulfilment === 'collect' && order.collectAt
      ? { when: formatCollectAt(order.collectAt, locale), label: shop.collectionLabel, instructions: shop.collectionInstructions }
      : null,
    lines: await Promise.all(lines.map(async l => ({
      id: l.id,
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      total: money(l.totalMinor),
      download: paid && l.isDigital
        ? { url: await downloadLink(event, siteId, l.id), ...downloadState(l, order.paidAt!, shop) }
        : null,
    }))),
  }
}
