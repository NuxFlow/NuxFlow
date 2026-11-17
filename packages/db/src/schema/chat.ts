import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { sites } from './sites'

/**
 * The website chatbot (apps/nuxflow/server/utils/chatbot*.ts, Admin → Chatbot). What it
 * knows comes from the site's published pages plus what the admin writes here, split into
 * chunks that are embedded into the shared Vectorize index under the namespace
 * `chat:<siteId>` (never the smart-search namespace, which is the bare site id).
 */

/** FAQ entries and free text the admin gives the chatbot. In the per-site backup. */
export const chatKnowledge = sqliteTable('chat_knowledge', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  // 'faq' = title is the question, body the answer. 'text' = anything else the bot should know.
  // 'document' = text taken from an uploaded file (the file itself isn't kept).
  kind: text('kind', { enum: ['faq', 'text', 'document'] }).notNull().default('faq'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  // For a document: the uploaded file's name and size.
  fileName: text('file_name'),
  fileSize: integer('file_size'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_chat_knowledge_site').on(t.siteId),
])

/**
 * One embedded piece of a source (a page, or a knowledge entry). The id is the vector's id
 * in Vectorize, which can only delete by id — so this table is how a rebuild, a removed page
 * or site deletion finds the vectors to remove. `sourceId` is a plain column (a content item
 * or chat_knowledge id): a FK would delete the rows without their vectors.
 * Not in the backup (rebuilt from the content); rows that are rebuilt, not people's data.
 */
export const chatChunks = sqliteTable('chat_chunks', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  sourceKind: text('source_kind', { enum: ['content', 'knowledge'] }).notNull(),
  sourceId: text('source_id').notNull(),
  n: integer('n').notNull(),
  title: text('title').notNull(),
  // The page's public path (null for knowledge entries) — shown as a source link.
  path: text('path'),
  text: text('text').notNull(),
  // SHA-256 of the source's whole text: an edit that doesn't change the text isn't re-embedded.
  hash: text('hash').notNull(),
  // The source's own updated_at when this was built; a different value means "look again".
  sourceUpdatedAt: text('source_updated_at').notNull(),
  // Embedding model id: a different index model means every chunk is re-embedded.
  model: text('model').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_chat_chunks_source').on(t.siteId, t.sourceKind, t.sourceId),
])

// Cascade target of chat_messages.conversationId below — a rebuild migration of this table
// would delete every message (see the landmine note on `sites`).
/** A visitor's conversation. People's data: not in the backup, pruned after 30 days. */
export const chatConversations = sqliteTable('chat_conversations', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  // SHA-256 of the random token the visitor's browser keeps; only that browser can continue it.
  visitorTokenHash: text('visitor_token_hash').notNull(),
  pagePath: text('page_path').notNull().default('/'),
  // Started from Admin → Chatbot → Try it: kept out of the transcripts list.
  isTest: integer('is_test', { mode: 'boolean' }).notNull().default(false),
  messageCount: integer('message_count').notNull().default(0),
  // Set when the visitor left their details; the enquiry is a thread in the Inbox.
  leadName: text('lead_name'),
  leadEmail: text('lead_email'),
  leadAt: text('lead_at'),
  // email_messages.thread_id of the enquiry — a plain column, like other Inbox links.
  inboxThreadId: text('inbox_thread_id'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  lastMessageAt: text('last_message_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_chat_conversations_site').on(t.siteId, t.lastMessageAt),
  index('idx_chat_conversations_last').on(t.lastMessageAt),
])

export interface ChatSource { title: string; path: string | null }

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  text: text('text').notNull(),
  sources: text('sources', { mode: 'json' }).$type<ChatSource[]>(),
  // An answer the bot couldn't give (it offered to pass the visitor on) — Admin → Chatbot → Insights.
  unanswered: integer('unanswered', { mode: 'boolean' }).notNull().default(false),
  // The visitor's thumbs: 1 helpful, -1 not.
  rating: integer('rating'),
  // Dealt with in Insights (an answer was added, or it was dismissed).
  reviewedAt: text('reviewed_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_chat_messages_conversation').on(t.conversationId, t.createdAt),
  index('idx_chat_messages_review').on(t.siteId, t.createdAt).where(sql`role = 'assistant' AND reviewed_at IS NULL AND (unanswered = 1 OR rating = -1)`),
])
