import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'
import { users } from './users'

// Target of ON DELETE SET NULL from subscriptions.tierId below — same DROP-TABLE-
// triggers-FK-actions landmine documented in full on `sites` in
// packages/db/src/schema/sites.ts. A future rebuild migration on `membership_tiers`
// would silently null out every subscription's tierId, for every site, with no error;
// verify against a real D1 deploy first, or hand-write the migration.
export const membershipTiers = sqliteTable('membership_tiers', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  price: real('price').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  interval: text('interval', { enum: ['month', 'year', 'one_time'] }).notNull().default('month'),
  features: text('features', { mode: 'json' }).$type<string[]>().notNull().default([]),
  // Provider-specific IDs set when tier is synced to payment provider
  stripeProductId: text('stripe_product_id'),
  stripePriceId: text('stripe_price_id'),
  lsProductId: text('ls_product_id'),
  lsVariantId: text('ls_variant_id'),
  paddleProductId: text('paddle_product_id'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_membership_tiers_site').on(t.siteId),
])

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tierId: text('tier_id').references(() => membershipTiers.id, { onDelete: 'set null' }),
  provider: text('provider', { enum: ['stripe', 'lemonsqueezy', 'paddle'] }).notNull(),
  providerSubscriptionId: text('provider_subscription_id').notNull(),
  providerCustomerId: text('provider_customer_id'),
  status: text('status', { enum: ['trialing', 'active', 'past_due', 'cancelled', 'unpaid'] }).notNull().default('active'),
  currentPeriodStart: text('current_period_start'),
  currentPeriodEnd: text('current_period_end'),
  cancelledAt: text('cancelled_at'),
  // Set when a user cancels but the paid period they already bought hasn't ended yet —
  // `status` deliberately stays 'active'/'trialing' so access continues (checkContentAccess
  // and every other status check already treat those as granting access), and this flag
  // just drives "Cancels on <date>" UI. The provider's own end-of-period webhook
  // (customer.subscription.deleted / subscription_expired / subscription.canceled) is what
  // finally flips `status` to 'cancelled' — see cancelSubscriptionFromWebhook in
  // webhook-sync.ts, which also resets this back to false at that point.
  cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_subscriptions_site_user').on(t.siteId, t.userId),
  index('idx_subscriptions_provider_id').on(t.provider, t.providerSubscriptionId),
  index('idx_subscriptions_site_status').on(t.siteId, t.status),
  // Providers redeliver webhooks (e.g. Stripe always sends both
  // checkout.session.completed and customer.subscription.created for one checkout, with
  // no ordering guarantee) — without a uniqueness constraint here, two concurrent
  // upserts for the same subscription can both miss each other's not-yet-committed row
  // and insert duplicates. This backs the atomic `ON CONFLICT` upsert in
  // upsertSubscriptionFromWebhook.
  uniqueIndex('idx_subscriptions_unique_provider_sub').on(t.siteId, t.provider, t.providerSubscriptionId),
  // A user holds at most one FREE-tier subscription row per tier per site, ever — the
  // free-tier checkout path (memberships/checkout.post.ts) already assumes this by
  // looking up and reusing a single row per (userId, siteId, tierId) rather than
  // inserting a new historical row on every resubscribe. Without this constraint, two
  // concurrent checkout requests for the same free tier can both miss each other's
  // not-yet-committed row and insert duplicates — this backs the atomic `ON CONFLICT`
  // upsert there. Deliberately partial (WHERE provider_subscription_id starts with
  // 'free_', the marker checkout.post.ts already uses for a free-tier row) rather than
  // covering every subscription: a *paid* tier legitimately gets a brand new row per
  // resubscribe over time (a fresh Stripe/LS/Paddle checkout after a full cancellation
  // gets a new provider subscription id, inserted by upsertSubscriptionFromWebhook's own
  // (site, provider, provider_subscription_id) upsert target) — a blanket
  // (site, user, tier) constraint would incorrectly reject that second, legitimate row.
  uniqueIndex('idx_subscriptions_unique_free_tier').on(t.siteId, t.userId, t.tierId)
    .where(sql`substr(${t.providerSubscriptionId}, 1, 5) = 'free_'`),
])

// Blocks of sessions a site sells, such as "10 classes". Never a target of an FK: a holding
// copies what it needs, so changing or deleting a pass doesn't touch what people bought.
export const classPasses = sqliteTable('class_passes', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  credits: integer('credits').notNull(),
  price: real('price').notNull(),
  currency: text('currency').notNull().default('USD'),
  // Days from purchase. Null: never expires.
  validDays: integer('valid_days'),
  // Reserved for docs/roadmap.md: nothing reads or writes these two yet.
  // Only for an address that has never bought from this site.
  introOnly: integer('intro_only', { mode: 'boolean' }).notNull().default(false),
  // Taxonomy terms of the classes it can be spent on. Null: every class.
  allowedTermIds: text('allowed_term_ids', { mode: 'json' }).$type<string[]>(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_class_passes_site').on(t.siteId),
])

// A pass someone bought. It belongs to an email address, not an account: visitors buy and
// use passes without signing up, and prove the address through emailed links.
export const classPassHoldings = sqliteTable('class_pass_holdings', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  // Plain column, no FK: see class_passes.
  passId: text('pass_id'),
  passName: text('pass_name').notNull(),
  email: text('email').notNull(),
  name: text('name').notNull().default(''),
  creditsTotal: integer('credits_total').notNull(),
  creditsUsed: integer('credits_used').notNull().default(0),
  expiresAt: text('expires_at'),
  status: text('status', { enum: ['active', 'refunded'] }).notNull().default('active'),
  amountPaid: real('amount_paid').notNull().default(0),
  amountRefunded: real('amount_refunded').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  // Null when the team added it by hand, such as a pass sold at the desk.
  stripeSessionId: text('stripe_session_id'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  // Reserved for docs/roadmap.md: nothing reads or writes the next six yet.
  // Copied from the pass when bought, as with its name. Null: every class.
  allowedTermIds: text('allowed_term_ids', { mode: 'json' }).$type<string[]>(),
  // amount_paid stays what the customer actually paid; these say how it was made up.
  amountDiscount: real('amount_discount'),
  discountCode: text('discount_code'),
  amountTax: real('amount_tax'),
  // Null means Stripe, using the stripe_* columns.
  paymentProvider: text('payment_provider'),
  providerOrderId: text('provider_order_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_class_pass_holdings_site_email').on(t.siteId, t.email),
  index('idx_class_pass_holdings_payment_intent').on(t.siteId, t.stripePaymentIntentId),
  // Stripe redelivers webhooks; a redelivery must not grant the credits twice.
  uniqueIndex('uq_class_pass_holdings_session').on(t.siteId, t.stripeSessionId).where(sql`stripe_session_id is not null`),
])
