import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { sites } from './sites'
import { users } from './users'

export const contentTypes = sqliteTable('content_types', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  singularName: text('singular_name').notNull(),
  icon: text('icon'),
  isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
  hasRevisions: integer('has_revisions', { mode: 'boolean' }).notNull().default(true),
  hasComments: integer('has_comments', { mode: 'boolean' }).notNull().default(false),
  schema: text('schema', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_content_types_site_slug').on(t.siteId, t.slug),
])

export const contentItems = sqliteTable('content_items', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  typeId: text('type_id').notNull().references(() => contentTypes.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  status: text('status', { enum: ['draft', 'review', 'published', 'scheduled', 'archived'] }).notNull().default('draft'),
  visibility: text('visibility', { enum: ['public', 'private', 'password', 'members'] }).notNull().default('public'),
  content: text('content', { mode: 'json' }).$type<unknown>(),
  excerpt: text('excerpt'),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  ogImage: text('og_image'),
  password: text('password'),
  publishedAt: text('published_at'),
  scheduledAt: text('scheduled_at'),
  previewToken: text('preview_token'),
  previewTokenExpiresAt: text('preview_token_expires_at'),
  settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>(),
  allowComments: integer('allow_comments', { mode: 'boolean' }),
  locale: text('locale').notNull().default('en'),
  sourceItemId: text('source_item_id').references((): AnySQLiteColumn => contentItems.id, { onDelete: 'set null' }),
  // Incremented on every PATCH — used for optimistic locking and offline sync conflict detection.
  version: integer('version').notNull().default(1),
  // Event fields — null on regular content; populated when a content type is used as an events calendar.
  // Stored as ISO 8601 strings so SQLite string comparisons work correctly for range queries.
  eventStartAt: text('event_start_at'),
  eventEndAt: text('event_end_at'),
  eventLocation: text('event_location'),
  eventUrl: text('event_url'),
  eventAllDay: integer('event_all_day', { mode: 'boolean' }),
  // GEO/LLMO optimisation fields
  canonicalUrl: text('canonical_url'),
  focusKeyword: text('focus_keyword'),
  metaRobots: text('meta_robots'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_content_items_site_type').on(t.siteId, t.typeId),
  index('idx_content_items_site_slug').on(t.siteId, t.slug),
  index('idx_content_items_site_status').on(t.siteId, t.status),
  index('idx_content_items_locale').on(t.siteId, t.locale),
  index('idx_content_items_source').on(t.sourceItemId),
  // Supports delta sync: WHERE site_id = ? AND updated_at > ? (used by offline clients on reconnect)
  index('idx_content_items_site_updated').on(t.siteId, t.updatedAt),
  // Used by the events calendar to range-query by event date
  index('idx_content_items_event_start').on(t.siteId, t.eventStartAt),
  // Covers the public listing hot path (posts.get.ts, feed.ts, taxonomy.ts queries):
  // WHERE site_id = ? AND status = 'published' AND visibility = 'public' ORDER BY published_at DESC.
  // idx_content_items_site_status alone still requires a separate sort step on published_at;
  // this one lets SQLite satisfy the filter and the ORDER BY from the index directly.
  index('idx_content_items_site_status_visibility_published').on(t.siteId, t.status, t.visibility, t.publishedAt),
  // Covers the admin content list hot path (content/index.get.ts): WHERE site_id = ? AND
  // type_id = ? [AND status = ?] ORDER BY updated_at DESC.
  index('idx_content_items_site_type_status_updated').on(t.siteId, t.typeId, t.status, t.updatedAt),
])

export const contentRevisions = sqliteTable('content_revisions', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  content: text('content', { mode: 'json' }).$type<unknown>(),
  title: text('title').notNull(),
  summary: text('summary'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_content_revisions_item').on(t.itemId),
])

export const taxonomies = sqliteTable('taxonomies', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  isHierarchical: integer('is_hierarchical', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_taxonomies_site_slug').on(t.siteId, t.slug),
])

export const taxonomyTerms = sqliteTable('taxonomy_terms', {
  id: text('id').primaryKey(),
  taxonomyId: text('taxonomy_id').notNull().references(() => taxonomies.id, { onDelete: 'cascade' }),
  // Deliberately NOT a DB-level self-reference: SQLite/D1's table-rebuild migration
  // strategy (required to add a FK to an already-existing column) makes a genuine
  // "DROP TABLE" on the old table, which — with an ON DELETE SET NULL FK already declared
  // on the new table pointing at it — triggers that SET NULL action for every row during
  // the drop's implicit whole-table DELETE (confirmed via sqlite.org/foreignkeys.html:
  // "may invoke foreign key actions"), silently nulling out every parentId in the entire
  // table as an unwanted side effect of the migration itself. Enforced in application code
  // instead — see terms/[termId].delete.ts, which nulls children's parentId explicitly
  // before removing the parent term.
  parentId: text('parent_id'),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_taxonomy_terms_taxonomy').on(t.taxonomyId),
])

export const contentTaxonomyTerms = sqliteTable('content_taxonomy_terms', {
  contentItemId: text('content_item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  termId: text('term_id').notNull().references(() => taxonomyTerms.id, { onDelete: 'cascade' }),
}, (t) => [
  index('idx_ctt_item').on(t.contentItemId),
  index('idx_ctt_term').on(t.termId),
  // Nothing previously stopped a duplicate (item, term) pair from being inserted — every
  // current write path happens to avoid it by construction (delete-then-insert, or a
  // first-seen map), but the schema itself gave no guarantee, and a duplicate silently
  // double-counts that item in every taxonomy-archive listing/count.
  uniqueIndex('idx_ctt_item_term').on(t.contentItemId, t.termId),
])

export const menus = sqliteTable('menus', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  location: text('location'),
  items: text('items', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_menus_site').on(t.siteId),
])

export const redirects = sqliteTable('redirects', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  from: text('from').notNull(),
  to: text('to').notNull(),
  statusCode: integer('status_code').notNull().default(301),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_redirects_site_from').on(t.siteId, t.from),
])

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  // Deliberately NOT a DB-level self-reference — see the comment on taxonomyTerms.parentId
  // in this same file for why (a migration adding this FK would trigger its own ON DELETE
  // SET NULL action against every row during the table-rebuild's implicit DROP TABLE,
  // silently nulling every parentId in the table). Enforced in application code instead —
  // see comments/[id].delete.ts, which nulls children's parentId explicitly before
  // removing the parent comment.
  parentId: text('parent_id'),
  guestName: text('guest_name'),
  guestEmail: text('guest_email'),
  body: text('body').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'spam', 'trash'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_comments_item').on(t.itemId),
  index('idx_comments_site_status').on(t.siteId, t.status),
])
