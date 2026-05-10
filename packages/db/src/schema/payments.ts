import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'
import { users } from './users'

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
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_subscriptions_site_user').on(t.siteId, t.userId),
  index('idx_subscriptions_provider_id').on(t.provider, t.providerSubscriptionId),
])
