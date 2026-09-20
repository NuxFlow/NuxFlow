import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Target of `ON DELETE CASCADE` FKs from nearly every other table in this schema
// (site_settings, content_types, content_items, taxonomies, menus, redirects, comments,
// forms, media, media_folders, video_assets, membership_tiers, subscriptions,
// user_site_roles, api_keys, and several more in system.ts) — SQLite's `DROP TABLE`
// performs an implicit whole-table `DELETE` that "may invoke foreign key actions"
// (sqlite.org/foreignkeys.html), so a future drizzle-kit table-rebuild migration on
// `sites` (triggered by dropping/renaming a column, changing a column's type, adding a
// FK to an already-existing column, or adding NOT NULL without every row already
// satisfying it) would silently cascade-delete every row in every one of those tables,
// for every site, with no error to catch it. Before running such a migration against
// `sites`, verify against a real Cloudflare D1 deploy first (wrangler dev's local D1
// emulation does not reproduce this — see the "General lesson" in CLAUDE.md's Database
// layer section), or hand-write the migration to avoid drizzle-kit's rebuild strategy
// entirely. See also `taxonomyTerms.parentId`/`comments.parentId`/`mediaFolders.parentId`
// (content.ts, media.ts) and `media.folderId` for the sibling landmine on self-/cross-
// referencing columns, which are plain columns with no DB-level FK for exactly this
// reason — and `users`/`contentItems`/`contentTypes`/`taxonomies`/`taxonomyTerms`/
// `membershipTiers` for the same cascade-target risk on a smaller scale.
export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull().unique(),
  locale: text('locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('UTC'),
  status: text('status', { enum: ['active', 'maintenance', 'suspended'] }).notNull().default('active'),
  setupCompleted: integer('setup_completed', { mode: 'boolean' }).notNull().default(false),
  setupTokenHash: text('setup_token_hash'),
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
