import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull().unique(),
  locale: text('locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('UTC'),
  status: text('status', { enum: ['active', 'maintenance', 'suspended'] }).notNull().default('active'),
  setupCompleted: integer('setup_completed', { mode: 'boolean' }).notNull().default(false),
  settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

export const siteSettings = sqliteTable('site_settings', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value', { mode: 'json' }).$type<unknown>(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_site_settings_site_key').on(t.siteId, t.key),
])
