import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'
import { users } from './users'

export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  url: text('url').notNull(),
  storageProvider: text('storage_provider', { enum: ['cloudflare', 'local', 'r2', 's3', 'bunny'] }).notNull().default('cloudflare'),
  storageKey: text('storage_key').notNull(),
  altText: text('alt_text'),
  caption: text('caption'),
  focalX: integer('focal_x'),
  focalY: integer('focal_y'),
  // Deliberately NOT a DB-level FK to mediaFolders — see the comment on
  // mediaFolders.parentId below for why (adding it via the required table-rebuild
  // migration would trigger its own ON DELETE SET NULL action against every row during
  // that migration's DROP TABLE step). media/folders/[id].delete.ts already nulls this
  // out explicitly before removing a folder.
  folderId: text('folder_id'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_media_site_folder').on(t.siteId, t.folderId),
  index('idx_media_folder').on(t.folderId),
])

export const mediaFolders = sqliteTable('media_folders', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  // Deliberately NOT a DB-level self-reference: SQLite/D1's table-rebuild migration
  // strategy (needed to add a FK to an already-existing column) does a genuine
  // "DROP TABLE" on the old table — with an ON DELETE SET NULL FK already declared on the
  // new table pointing at it, that DROP's implicit whole-table DELETE triggers the SET
  // NULL action for every row (confirmed via sqlite.org/foreignkeys.html: dropping a
  // table "may invoke foreign key actions"), silently nulling every parentId/folderId in
  // the table as a side effect of the migration itself, on real D1. Enforced in
  // application code instead — see folders/[id].delete.ts, which nulls children's
  // parentId explicitly before removing the parent folder.
  parentId: text('parent_id'),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_media_folders_site').on(t.siteId),
  // Covers folders/[id].delete.ts's reparenting UPDATE (WHERE site_id = ? AND
  // parent_id = ?) — without this, promoting a deleted folder's children to root level
  // is a full per-site scan on every folder delete.
  index('idx_media_folders_site_parent').on(t.siteId, t.parentId),
])

export const videoAssets = sqliteTable('video_assets', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  cloudflareStreamId: text('cloudflare_stream_id').notNull(),
  title: text('title').notNull(),
  duration: integer('duration'),
  thumbnailUrl: text('thumbnail_url'),
  status: text('status', { enum: ['ready', 'processing', 'failed', 'uploading'] }).notNull().default('uploading'),
  size: integer('size'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_video_assets_site').on(t.siteId),
])
