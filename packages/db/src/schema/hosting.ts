import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Hosting plans — what the platform operator sells to a site owner ("Starter: 1 GB
// storage, 20,000 views a month"). Not to be confused with `membership_tiers`
// (payments.ts), which a site sells to its own visitors. A site points at a plan through
// the plain `sites.hosting_plan_id` column (no DB-level FK: see the comment on `sites`);
// a null plan id is the built-in, unlimited plan. Every `max_*` column is a limit, and
// null means unlimited. Enforcement lives in apps/nuxflow/server/utils/hosting-plans.ts.
export const hostingPlans = sqliteTable('hosting_plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** Shown only — payment is handled elsewhere. */
  priceText: text('price_text').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  // Hard limits: the action that would go over is refused.
  maxStorageBytes: integer('max_storage_bytes'),
  maxContentItems: integer('max_content_items'),
  maxTeamMembers: integer('max_team_members'),
  maxSiteMembers: integer('max_site_members'),
  maxPlugins: integer('max_plugins'),
  maxAiCallsPerMonth: integer('max_ai_calls_per_month'),
  maxEmailsPerMonth: integer('max_emails_per_month'),
  // Soft limits: counted only; the operator is notified at 80% and 100%.
  maxViewsPerMonth: integer('max_views_per_month'),
  maxRendersPerMonth: integer('max_renders_per_month'),
  // Selling the plan (the hosting-platform sign-up, apps/nuxflow/server/utils/hosting-billing.ts).
  // Prices are in major units (5 = £5); null = not offered at that interval. NuxFlow
  // creates the Stripe product/prices from these and keeps their ids here — a changed
  // amount gets a new Stripe price (prices are immutable), existing subscribers stay on
  // the old one until the operator moves them.
  /** Shown on the sign-up page. A plan that isn't public can still be given out by hand. */
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  priceMonthly: real('price_monthly'),
  priceYearly: real('price_yearly'),
  currency: text('currency').notNull().default('gbp'),
  /** Free days before the first charge (card taken at sign-up). 0 = none. */
  trialDays: integer('trial_days').notNull().default(0),
  stripeProductId: text('stripe_product_id'),
  stripePriceMonthlyId: text('stripe_price_monthly_id'),
  stripePriceYearlyId: text('stripe_price_yearly_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

// One row per customer sign-up on a hosting platform: the Stripe subscription that pays
// for one customer site. Platform data, not tenant data — `hostedSiteId` is the site it
// pays for, deliberately not named `site_id` (the integration tests' tenant query guard
// treats a `site_id` column as "must be filtered by the request's site", which this table
// never is) and a plain column with no FK, like `sites.hosting_plan_id`: deleting a site
// must not silently delete the record that it was being paid for (the deletion path
// cancels the subscription instead). Same for `ownerUserId` and `planId`.
export const hostingSubscriptions = sqliteTable('hosting_subscriptions', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  planId: text('plan_id').notNull(),
  interval: text('interval', { enum: ['month', 'year'] }).notNull(),
  /** `checkout` until Stripe confirms payment; then Stripe's own subscription status. */
  status: text('status').notNull().default('checkout'),
  /** What the customer asked for at sign-up; the site is created from these. */
  requestedSubdomain: text('requested_subdomain').notNull(),
  requestedSiteName: text('requested_site_name').notNull(),
  template: text('template').notNull().default('landing'),
  hostedSiteId: text('hosted_site_id'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').unique(),
  currentPeriodEnd: text('current_period_end'),
  cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
  /** When Stripe first reported the payment failing (cleared once it's paid). */
  pastDueSince: text('past_due_since'),
  /** True while NuxFlow has put the site into maintenance for non-payment, so it knows to reopen it once paid. */
  pausedForNonPayment: integer('paused_for_non_payment', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, t => [
  index('idx_hosting_subscriptions_owner').on(t.ownerUserId),
  index('idx_hosting_subscriptions_site').on(t.hostedSiteId),
  index('idx_hosting_subscriptions_subdomain').on(t.requestedSubdomain),
])
