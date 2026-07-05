import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'
import { users } from './users'

export const themes = sqliteTable('themes', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  packageName: text('package_name').notNull(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  hasCss: integer('has_css', { mode: 'boolean' }).notNull().default(false),
  settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>(),
  installedAt: text('installed_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_themes_site').on(t.siteId),
])

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  resourceId: text('resource_id'),
  before: text('before', { mode: 'json' }).$type<unknown>(),
  after: text('after', { mode: 'json' }).$type<unknown>(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_audit_logs_site').on(t.siteId),
  index('idx_audit_logs_resource').on(t.resource, t.resourceId),
  index('idx_audit_logs_site_user').on(t.siteId, t.userId),
])

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_notifications_user_site').on(t.userId, t.siteId),
])


export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  resetAt: text('reset_at').notNull(),
})

export const dynamicPlugins = sqliteTable('dynamic_plugins', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  version: text('version').notNull(),
  description: text('description').notNull().default(''),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  hasServer: integer('has_server', { mode: 'boolean' }).notNull().default(false),
  hasClient: integer('has_client', { mode: 'boolean' }).notNull().default(false),
  // SHA-256 hex of the raw (pre-base64) code stored in KV.
  // Verified on every retrieval to detect KV tampering.
  serverChecksum: text('server_checksum'),
  clientChecksum: text('client_checksum'),
  // Ed25519 publisher identity — stored on first install, verified on every update.
  // An empty string means the plugin pre-dates signing (should never occur post-launch).
  publisherPublicKey: text('publisher_public_key').notNull().default(''),
  signature: text('signature').notNull().default(''),
  installedAt: text('installed_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_dynamic_plugins_site').on(t.siteId),
])

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_push_subs_site').on(t.siteId),
  index('idx_push_subs_user_site').on(t.userId, t.siteId),
])

export const aiGenerationJobs = sqliteTable('ai_generation_jobs', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  prompt: text('prompt').notNull(),
  type: text('type', { enum: ['page', 'site'] }).notNull().default('page'),
  plan: text('plan', { mode: 'json' }).$type<Array<{ title: string; slug: string; description: string }>>(),
  status: text('status', { enum: ['planning', 'approved', 'generating', 'complete', 'failed'] }).notNull().default('planning'),
  generatedCount: integer('generated_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
  contentItemIds: text('content_item_ids', { mode: 'json' }).$type<string[]>(),
  error: text('error'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_ai_gen_jobs_site').on(t.siteId),
  index('idx_ai_gen_jobs_user_site').on(t.userId, t.siteId),
])

// Virtual FTS5 table, backfill, and sync triggers — created via raw SQL in migration,
// not via Drizzle (drizzle-kit can't express virtual tables or triggers).
// See migrations/0002_search_index.sql. Kept in sync automatically by AFTER
// INSERT/UPDATE/DELETE triggers on content_items — no application code indexes
// content explicitly; only published + public items are searchable.
export const searchIndexSql = `
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  content_item_id UNINDEXED,
  site_id UNINDEXED,
  title,
  body,
  tokenize = 'porter ascii'
);
`
