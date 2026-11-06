import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { sites } from './sites'
import { users } from './users'

// Target of ON DELETE CASCADE from contentItems.typeId below — same DROP-TABLE-
// triggers-FK-actions landmine documented in full on `sites` in sites.ts. A future
// rebuild migration on `content_types` would silently delete every content item of
// that type, for every site, with no error; verify against a real D1 deploy first, or
// hand-write the migration.
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

// Target of ON DELETE CASCADE from contentRevisions.itemId, contentTaxonomyTerms.contentItemId,
// eventRsvps.contentItemId and comments.itemId — same DROP-TABLE-triggers-FK-actions landmine documented in full
// on `sites` in sites.ts. Also self-referenced by sourceItemId below (ON DELETE SET
// NULL, used for translation/duplication tracking) — unlike taxonomyTerms.parentId/
// comments.parentId elsewhere in this schema, that self-FK genuinely exists at the DB
// level today, so a rebuild migration on `content_items` would additionally null out
// every row's sourceItemId as a side effect of its own DROP TABLE, on top of cascading
// into the three tables above. Verify against a real D1 deploy before any migration
// that would trigger drizzle-kit's rebuild strategy on this table, or hand-write it.
export const contentItems = sqliteTable('content_items', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  typeId: text('type_id').notNull().references(() => contentTypes.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  status: text('status', { enum: ['draft', 'review', 'published', 'scheduled', 'archived'] }).notNull().default('draft'),
  // 'password' was removed from this enum — it was scaffolded (a dead branch in
  // checkContentAccess and this enum value) but never actually implemented: nothing ever
  // wrote it (deriveVisibilityFromSettings only ever produces 'public'/'members'), and the
  // dead branch silently required a paid subscription instead of a password if it had ever
  // been reachable. No DB migration needed — SQLite has no native enum type, so Drizzle's
  // `enum` option here is TypeScript-only, not a DB-level CHECK constraint.
  // 'password': settings.access = 'password' + settings.passwordHash (apps/nuxflow/server/utils/page-password.ts).
  visibility: text('visibility', { enum: ['public', 'private', 'members', 'password'] }).notNull().default('public'),
  content: text('content', { mode: 'json' }).$type<unknown>(),
  excerpt: text('excerpt'),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  ogImage: text('og_image'),
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
  // A timed event is a UTC instant; an all-day event is its date at midnight UTC, with an
  // inclusive end date (see @nuxflow/canvas/events).
  eventStartAt: text('event_start_at'),
  eventEndAt: text('event_end_at'),
  eventLocation: text('event_location'),
  eventUrl: text('event_url'),
  eventAllDay: integer('event_all_day', { mode: 'boolean' }),
  // RSVPs (server/utils/event-rsvp.ts). A null capacity means unlimited; a null closing
  // time means RSVPs stay open until the event starts.
  eventRsvpEnabled: integer('event_rsvp_enabled', { mode: 'boolean' }),
  eventRsvpCapacity: integer('event_rsvp_capacity'),
  eventRsvpClosesAt: text('event_rsvp_closes_at'),
  // Repeating events: the stored start and end are the first date's, the other dates are
  // worked out from this rule (`@nuxflow/canvas/events`). Bookings are per date.
  eventRecurrence: text('event_recurrence', { mode: 'json' }).$type<{
    freq: 'daily' | 'weekly' | 'monthly'
    interval: number
    weekdays?: number[]
    until?: string | null
    skip?: string[]
  }>(),
  // Paid bookings. No price, or 0, is a free RSVP. In major units, like membership tiers.
  eventPrice: real('event_price'),
  eventCurrency: text('event_currency'),
  // Hours before the start that cancelling stops giving money or credits back. Null: until it starts.
  eventCancelHours: integer('event_cancel_hours'),
  // Whether a paid event can be booked with a class pass. Null counts as yes.
  eventPassesAllowed: integer('event_passes_allowed', { mode: 'boolean' }),
  // Reserved for docs/roadmap.md: nothing reads or writes these three yet.
  // Sessions a pass pays per place. Null counts as 1.
  eventPassCredits: integer('event_pass_credits'),
  // event_resources rows. Plain columns with no FK: this table is a cascade target (see above).
  eventTeacherId: text('event_teacher_id'),
  eventRoomId: text('event_room_id'),
  // GEO/LLMO optimisation fields
  canonicalUrl: text('canonical_url'),
  focusKeyword: text('focus_keyword'),
  metaRobots: text('meta_robots'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_content_items_site_type').on(t.siteId, t.typeId),
  // Unique, not just indexed: routing (public pages, posts, taxonomy archives) resolves
  // content by (site_id, slug) alone via findFirst() with no tie-breaker, so two items
  // silently sharing a slug previously meant "which one the site actually serves" was
  // undefined and could change across a reinsert/migration. Content create/update routes
  // pre-check for a conflict and return a friendly 409 before ever hitting this constraint.
  uniqueIndex('idx_content_items_site_slug_unique').on(t.siteId, t.slug),
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
  // The every-minute publish-scheduled cron (server/scheduled/publish-scheduled.ts) looks
  // across every site: WHERE status = 'scheduled' AND scheduled_at <= now. Every index
  // above leads with site_id, so without this one that query read every row in the table
  // once a minute. Partial, so it only ever holds the handful of scheduled items. A plain
  // CREATE INDEX — no table rebuild (see the landmine note on this table).
  index('idx_content_items_scheduled').on(t.scheduledAt).where(sql`${t.status} = 'scheduled'`),
  // For a timetable filtered by teacher or room, and for finding a room booked twice.
  index('idx_content_items_event_teacher').on(t.siteId, t.eventTeacherId).where(sql`event_teacher_id is not null`),
  index('idx_content_items_event_room').on(t.siteId, t.eventRoomId).where(sql`event_room_id is not null`),
])

// Who is coming to an event. The address is the identity, so one row per address per
// event; `seats` is how many places that person is asking for. Only 'confirmed' seats
// count against the capacity. Translations of an event share the original's list.
export const eventRsvps = sqliteTable('event_rsvps', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  contentItemId: text('content_item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  seats: integer('seats').notNull().default(1),
  // pending: waiting for the emailed link. held: seats kept during card checkout. offered:
  // seats kept for someone off a paid event's waitlist, until they pay. Both of those count
  // against capacity until hold_expires_at.
  status: text('status', { enum: ['pending', 'held', 'offered', 'confirmed', 'waitlist', 'cancelled'] }).notNull().default('pending'),
  // Which date of a repeating event, `YYYY-MM-DD` in the site's zone. Empty for a one-off.
  occurrenceDate: text('occurrence_date').notNull().default(''),
  // When this booking's date starts, so reminders and "upcoming" don't re-work out the rule.
  startsAt: text('starts_at'),
  holdExpiresAt: text('hold_expires_at'),
  // How it's paid for. Null: free.
  paymentMethod: text('payment_method', { enum: ['card', 'pass'] }),
  paymentStatus: text('payment_status', { enum: ['paid', 'refunded'] }),
  amountPaid: real('amount_paid'),
  currency: text('currency'),
  stripeSessionId: text('stripe_session_id'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  // Plain column, no FK: erasing a holding's row must not touch the booking.
  passHoldingId: text('pass_holding_id'),
  creditsSpent: integer('credits_spent').notNull().default(0),
  // Reserved for docs/roadmap.md: nothing reads or writes the next seven yet.
  // Null: not marked. Only ever set on a confirmed booking.
  attendance: text('attendance', { enum: ['attended', 'no_show'] }),
  attendanceAt: text('attendance_at'),
  // amount_paid stays what the customer actually paid; these say how it was made up.
  amountDiscount: real('amount_discount'),
  discountCode: text('discount_code'),
  amountTax: real('amount_tax'),
  // Null means Stripe, using the stripe_* columns. Another provider's single order id goes
  // in provider_order_id.
  paymentProvider: text('payment_provider'),
  providerOrderId: text('provider_order_id'),
  reminderSentAt: text('reminder_sent_at'),
  confirmSentAt: text('confirm_sent_at'),
  // When the address was confirmed — also the place in the waitlist queue.
  confirmedAt: text('confirmed_at'),
  cancelledAt: text('cancelled_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  uniqueIndex('uq_event_rsvps_item_date_email').on(t.contentItemId, t.occurrenceDate, t.email),
  index('idx_event_rsvps_site_item_status').on(t.siteId, t.contentItemId, t.status),
  index('idx_event_rsvps_site_email').on(t.siteId, t.email),
  index('idx_event_rsvps_payment_intent').on(t.siteId, t.stripePaymentIntentId),
  // What the hourly sweep looks for across every site (scheduled/event-bookings.ts).
  index('idx_event_rsvps_holds').on(t.holdExpiresAt).where(sql`status in ('held', 'offered')`),
  index('idx_event_rsvps_reminders').on(t.startsAt).where(sql`status = 'confirmed' and reminder_sent_at is null`),
])

// Teachers and rooms a class can have. Reserved for docs/roadmap.md: nothing uses it yet.
// Never a target of an FK, so deleting one can't touch events or bookings.
export const eventResources = sqliteTable('event_resources', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['teacher', 'room'] }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  imageUrl: text('image_url'),
  // A room's places, for capping a class held in it. Null: no limit.
  capacity: integer('capacity'),
  // A teacher's account, if they have one. Plain column: most won't.
  userId: text('user_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_event_resources_site_kind').on(t.siteId, t.kind, t.sortOrder),
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

// Target of ON DELETE CASCADE from taxonomyTerms.taxonomyId below — same landmine as
// `sites` (see sites.ts for the full explanation). A future rebuild migration on
// `taxonomies` would silently delete every term in every taxonomy, for every site, with
// no error; verify against a real D1 deploy first, or hand-write the migration.
export const taxonomies = sqliteTable('taxonomies', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isHierarchical: integer('is_hierarchical', { mode: 'boolean' }).notNull().default(false),
  // Per-taxonomy noindex for its archive pages, on top of the site-wide
  // `seo.noindex_taxonomies` switch (either one noindexes the archive).
  noindex: integer('noindex', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_taxonomies_site_slug').on(t.siteId, t.slug),
])

// Which content types a taxonomy applies to. No rows for a taxonomy means "every type"
// (the editor's term picker and the admin UI both treat it that way), so a taxonomy
// created before this table existed keeps working unchanged.
export const taxonomyContentTypes = sqliteTable('taxonomy_content_types', {
  taxonomyId: text('taxonomy_id').notNull().references(() => taxonomies.id, { onDelete: 'cascade' }),
  contentTypeId: text('content_type_id').notNull().references(() => contentTypes.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('idx_taxonomy_content_types_unique').on(t.taxonomyId, t.contentTypeId),
  index('idx_taxonomy_content_types_type').on(t.contentTypeId),
])

// Besides the self-referencing parentId landmine documented below, this table is
// itself the target of ON DELETE CASCADE from contentTaxonomyTerms.termId — same
// DROP-TABLE-triggers-FK-actions class of risk documented in full on `sites` in
// sites.ts. A future rebuild migration on `taxonomy_terms` would silently delete every
// content-to-term assignment, for every site, with no error; verify against a real D1
// deploy first, or hand-write the migration.
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
  // Manual ordering within a taxonomy (ascending, then name) — admin list, term picker,
  // and public term lists all sort by it.
  sortOrder: integer('sort_order').notNull().default(0),
  // Archive-page SEO overrides; null falls back to "{term} — {taxonomy}" / the term's
  // description / the site's default share image.
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  ogImage: text('og_image'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_taxonomy_terms_taxonomy').on(t.taxonomyId),
  // A duplicate slug within the same taxonomy makes one term's content permanently
  // unreachable via its canonical archive URL (findFirst on (taxonomy_id, slug) picks one
  // arbitrarily) — same class of bug as content_items' slug uniqueness above.
  uniqueIndex('idx_taxonomy_terms_taxonomy_slug_unique').on(t.taxonomyId, t.slug),
  // Covers terms/[termId].delete.ts's reparenting UPDATE (WHERE taxonomy_id = ? AND
  // parent_id = ?) — without this, promoting a deleted term's children to top-level is a
  // full per-taxonomy scan on every term delete.
  index('idx_taxonomy_terms_taxonomy_parent').on(t.taxonomyId, t.parentId),
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
  // Covers comments/[id].delete.ts's reparenting UPDATE (WHERE site_id = ? AND
  // parent_id = ?) — without this, promoting a deleted comment's replies to top-level is a
  // full per-site scan on every comment delete, which matters more here than for
  // taxonomy_terms/media_folders since comment threads can grow large and deep.
  index('idx_comments_site_parent').on(t.siteId, t.parentId),
])
