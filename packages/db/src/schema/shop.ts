import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'
import { contentItems } from './content'

/**
 * Everything a site sells for money in one place: shop products, but also class bookings,
 * class passes and one-time membership tiers. One Orders page, one refund path, one sales
 * report. What's specific to a booking or a pass stays in its own table; an order line
 * points at it.
 *
 * Money is whole minor units (pence, cents; yen for zero-decimal currencies), the same
 * numbers Stripe uses, never a decimal. An order belongs to an email address, not an
 * account: guests buy without signing up.
 */

// Target of ON DELETE CASCADE from order_lines and order_refunds below — a rebuild migration
// on `orders` (see the landmine notes in CLAUDE.md) would silently delete every line and
// refund of every order. Hand-write any change that would need one.
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  // What the customer and the team call it ("Order 1042"): per site, from 1001 up.
  number: integer('number').notNull(),
  // pending: at the checkout, not paid. expired: the checkout closed unpaid.
  // cancelled: never reached the payment provider. The rest have been paid.
  status: text('status', { enum: ['pending', 'paid', 'partially_refunded', 'refunded', 'expired', 'cancelled'] }).notNull().default('pending'),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  // Set when a signed-in member bought it. Plain column, no FK: an order outlives the account.
  userId: text('user_id'),
  currency: text('currency').notNull(),
  subtotalMinor: integer('subtotal_minor').notNull().default(0),
  discountMinor: integer('discount_minor').notNull().default(0),
  shippingMinor: integer('shipping_minor').notNull().default(0),
  taxMinor: integer('tax_minor').notNull().default(0),
  // What the customer is charged: from the provider once paid.
  totalMinor: integer('total_minor').notNull().default(0),
  // max(our own refunds, what Stripe last said had been refunded) — see orders.ts.
  refundedMinor: integer('refunded_minor').notNull().default(0),
  stripeRefundedMinor: integer('stripe_refunded_minor').notNull().default(0),
  provider: text('provider').notNull().default('stripe'),
  stripeSessionId: text('stripe_session_id'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  paidAt: text('paid_at'),
  // Shop orders: stock is kept for them until this passes (the checkout's end plus a margin),
  // then given back by the every-minute sweep if they haven't paid.
  holdExpiresAt: text('hold_expires_at'),
  // Where to post it, as Stripe Checkout collected it. Null for anything with nothing to post.
  shippingAddress: text('shipping_address', { mode: 'json' }).$type<{ name?: string | null; phone?: string | null; line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null }>(),
  // When the customer ticked "I've read the returns policy".
  termsAcceptedAt: text('terms_accepted_at'),
  // Click and collect: 'collect' with the chosen time (site time, "YYYY-MM-DDTHH:MM", or a
  // day alone), else 'delivery' (also downloads-only orders).
  fulfilment: text('fulfilment', { enum: ['delivery', 'collect'] }).notNull().default('delivery'),
  collectAt: text('collect_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  uniqueIndex('uq_orders_site_number').on(t.siteId, t.number),
  // The hold sweep runs every minute across every site.
  index('idx_orders_pending_hold').on(t.holdExpiresAt).where(sql`status = 'pending' and hold_expires_at is not null`),
  index('idx_orders_site_created').on(t.siteId, t.createdAt),
  index('idx_orders_site_status').on(t.siteId, t.status),
  index('idx_orders_site_email').on(t.siteId, t.email),
  index('idx_orders_session').on(t.siteId, t.stripeSessionId),
  index('idx_orders_payment_intent').on(t.siteId, t.stripePaymentIntentId),
])

export const orderLines = sqliteTable('order_lines', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['product', 'booking', 'pass', 'tier'] }).notNull(),
  // What was bought: an event's content item, a class pass, a membership tier, a product
  // variant. Plain columns, no FK: the line keeps its own copy of the name and price.
  refId: text('ref_id'),
  // What buying it made: the event_rsvps row, the class_pass_holdings row, the subscription.
  recordId: text('record_id'),
  name: text('name').notNull(),
  description: text('description'),
  quantity: integer('quantity').notNull().default(1),
  unitMinor: integer('unit_minor').notNull(),
  totalMinor: integer('total_minor').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  // Product lines: the product (content item) and whether it's posted or downloaded.
  productId: text('product_id'),
  isDigital: integer('is_digital', { mode: 'boolean' }).notNull().default(false),
  // How many were taken from the variant's stock for this line: while the customer pays,
  // and kept once paid. Given back (and set to 0) when an unpaid checkout lapses.
  stockTaken: integer('stock_taken').notNull().default(0),
  // Times a digital line has been downloaded (see shop-downloads.ts).
  downloads: integer('downloads').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_order_lines_order').on(t.orderId),
  index('idx_order_lines_site_kind').on(t.siteId, t.kind),
  index('idx_order_lines_record').on(t.siteId, t.recordId),
])

// Money given back. Our own refunds are kept by the provider's refund id, so a retry or a
// redelivered webhook can't count one twice. Refunds made in Stripe's dashboard only show up
// as `orders.stripe_refunded_minor`.
export const orderRefunds = sqliteTable('order_refunds', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  amountMinor: integer('amount_minor').notNull(),
  reason: text('reason'),
  stripeRefundId: text('stripe_refund_id').notNull(),
  // Who pressed the button. Null for automatic refunds (a place gone by the time they paid).
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_order_refunds_order').on(t.orderId),
  uniqueIndex('uq_order_refunds_stripe').on(t.siteId, t.stripeRefundId),
])

/**
 * A product is a content item of the `product` type, so it has the editor, revisions,
 * translations, collections (a taxonomy), search, the sitemap and the page cache like any
 * page. What's shop-specific lives here, never as columns on content_items. Every product
 * has at least one variant; a product with no options has exactly one, with no options.
 */
export const products = sqliteTable('products', {
  contentItemId: text('content_item_id').primaryKey().references(() => contentItems.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  // The option names in order, e.g. ["Size", "Colour"]. Each variant has a value for each.
  optionNames: text('option_names', { mode: 'json' }).$type<string[]>().notNull().default([]),
  // More pictures after the featured image (the item's og_image), from the media library.
  images: text('images', { mode: 'json' }).$type<{ url: string; alt?: string }[]>().notNull().default([]),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_products_site').on(t.siteId),
])

export const productVariants = sqliteTable('product_variants', {
  // Made in the editor (a ULID), so autosave can't create a variant twice.
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  contentItemId: text('content_item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  sku: text('sku'),
  // One value per option name, in the same order, e.g. ["M", "Blue"].
  options: text('options', { mode: 'json' }).$type<string[]>().notNull().default([]),
  // In the shop's currency (setting shop.currency), minor units.
  priceMinor: integer('price_minor').notNull(),
  // "Was" price, shown struck through. Null: none.
  compareAtMinor: integer('compare_at_minor'),
  // How many can still be sold. Null: not tracked, never runs out. Checkout takes from it
  // while someone pays and gives it back if they don't, so it never goes below 0.
  stock: integer('stock'),
  weightGrams: integer('weight_grams'),
  kind: text('kind', { enum: ['physical', 'digital'] }).notNull().default('physical'),
  imageUrl: text('image_url'),
  // A digital variant's file, in the private part of the media bucket
  // (_private/<siteId>/shop/…), handed out only through signed download links.
  fileKey: text('file_key'),
  fileName: text('file_name'),
  fileSize: integer('file_size'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_product_variants_item').on(t.contentItemId),
  index('idx_product_variants_site_sku').on(t.siteId, t.sku),
])
