import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
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
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})
