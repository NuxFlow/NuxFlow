import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
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
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_content_items_site_type').on(t.siteId, t.typeId),
  index('idx_content_items_site_slug').on(t.siteId, t.slug),
  index('idx_content_items_status').on(t.status),
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
  parentId: text('parent_id'),
  guestName: text('guest_name'),
  guestEmail: text('guest_email'),
  body: text('body').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'spam', 'trash'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_comments_item').on(t.itemId),
])
