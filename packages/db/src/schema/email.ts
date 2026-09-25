import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'
import { users } from './users'

/**
 * An address this site receives mail at — `contact@`, `leads@`, or an author's secret
 * post-by-email address. Addresses are NuxFlow's own namespace, not something provisioned
 * in Cloudflare per address: the domain has one catch-all Email Routing rule pointing at
 * this Worker, and `server/utils/inbound-email.ts` resolves the recipient against this
 * table. Creating or deleting a mailbox therefore needs no Cloudflare API call.
 *
 * `localPart` is stored lowercase and matched after stripping any `+tag` sub-address. The
 * same row answers on both the site's own domain (`contact@site.com`) and, when the
 * operator configured a platform inbound domain, on `<handle>+contact@in.platform.com`
 * (see `email.inbound_handle` in inbound-email.ts) — tenants whose domain isn't a zone in
 * this Cloudflare account forward their mail there.
 */
export const mailboxes = sqliteTable('mailboxes', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  localPart: text('local_part').notNull(),
  name: text('name').notNull(),
  // 'inbox' → messages land in Admin → Inbox. 'post' → email-to-draft: the message
  // becomes a draft content item owned by `userId` (see inbound-email.ts).
  kind: text('kind', { enum: ['inbox', 'post'] }).notNull().default('inbox'),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  // Optional copy to an external mailbox via message.forward(). Cloudflare only forwards
  // to *verified* destination addresses (account-level, dashboard or
  // `wrangler email routing addresses create`), so an unverified value fails silently at
  // Cloudflare's end — the UI says so next to the field.
  forwardTo: text('forward_to'),
  notify: integer('notify', { mode: 'boolean' }).notNull().default(true),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  uniqueIndex('uq_mailboxes_site_local').on(t.siteId, t.localPart),
])

export interface EmailAttachmentMeta {
  filename: string
  contentType: string
  size: number
  /** R2 key under `<siteId>/email/…`, or null when no bucket was bound at receive time. */
  key: string | null
}

export interface EmailAuthResults {
  spf?: string
  dkim?: string
  dmarc?: string
}

/**
 * Both directions of an inbox conversation — inbound mail received via Email Routing and
 * the replies sent from Admin → Inbox — so a thread is one query on `threadId` (the id of
 * the thread's first message). Bodies are capped before insert (MAX_STORED_BODY_CHARS in
 * inbound-email.ts) to stay well clear of D1's 2 MB row limit; the untouched original
 * `.eml` lives in R2 at `rawKey`.
 *
 * `mailboxId` is a plain column, not an FK — deleting a mailbox keeps its history (the
 * delete route clears the column instead), and not declaring it avoids making `mailboxes`
 * a cascade target (see the rebuild-migration landmine in CLAUDE.md).
 */
export const emailMessages = sqliteTable('email_messages', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  mailboxId: text('mailbox_id'),
  threadId: text('thread_id').notNull(),
  direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
  messageId: text('message_id'),
  inReplyTo: text('in_reply_to'),
  references: text('references'),
  fromAddress: text('from_address').notNull(),
  fromName: text('from_name'),
  toAddress: text('to_address').notNull(),
  subject: text('subject').notNull().default(''),
  snippet: text('snippet').notNull().default(''),
  textBody: text('text_body'),
  htmlBody: text('html_body'),
  attachments: text('attachments', { mode: 'json' }).$type<EmailAttachmentMeta[]>(),
  auth: text('auth', { mode: 'json' }).$type<EmailAuthResults>(),
  status: text('status', { enum: ['new', 'read', 'archived', 'spam'] }).notNull().default('new'),
  // AI triage label ('lead' | 'support' | 'other') and one-line summary — both optional,
  // filled in the background after receipt when an AI provider is configured.
  category: text('category'),
  aiSummary: text('ai_summary'),
  rawKey: text('raw_key'),
  size: integer('size').notNull().default(0),
  sentByUserId: text('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  // Set when a post-by-email message was turned into a draft.
  contentItemId: text('content_item_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_email_messages_site_status').on(t.siteId, t.status, t.createdAt),
  index('idx_email_messages_thread').on(t.siteId, t.threadId),
  index('idx_email_messages_message_id').on(t.siteId, t.messageId),
])

/**
 * One row per outbound email attempt, from every sender in the app (auth, invites,
 * notifications, inbox replies). Cloudflare's sending quota is per *account*, shared by
 * every site on this deployment, so this is how an operator sees which site is using it
 * and which sends are failing (suppressed recipients, unverified sender domain). Pruned
 * by prune-old-data after EMAIL_LOG_RETENTION_DAYS.
 */
export const emailLog = sqliteTable('email_log', {
  id: text('id').primaryKey(),
  siteId: text('site_id').references(() => sites.id, { onDelete: 'cascade' }),
  toAddress: text('to_address').notNull(),
  subject: text('subject').notNull(),
  category: text('category').notNull().default('general'),
  provider: text('provider').notNull(),
  status: text('status', { enum: ['sent', 'failed'] }).notNull(),
  error: text('error'),
  providerMessageId: text('provider_message_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_email_log_site_created').on(t.siteId, t.createdAt),
])
