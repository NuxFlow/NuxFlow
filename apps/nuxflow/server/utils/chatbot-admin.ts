import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { chatConversations, chatKnowledge, chatMessages } from '@nuxflow/db/schema'
import type { Db } from './db'
import { notFound, validationError } from './response'
import type { ChatConversationSummary, ChatKnowledgeEntry, ChatTranscriptMessage } from '../../shared/lib/chatbot'

/** Admin → Chatbot: knowledge entries and transcripts (server/utils/chatbot.ts has the rest). */

export const MAX_KNOWLEDGE_ENTRIES = 500
export const KNOWLEDGE_TITLE_MAX = 300
export const KNOWLEDGE_BODY_MAX = 4000

export async function listKnowledge(db: Db, siteId: string): Promise<ChatKnowledgeEntry[]> {
  return db.select({
    id: chatKnowledge.id,
    kind: chatKnowledge.kind,
    title: chatKnowledge.title,
    body: chatKnowledge.body,
    enabled: chatKnowledge.enabled,
    updatedAt: chatKnowledge.updatedAt,
  })
    .from(chatKnowledge)
    .where(eq(chatKnowledge.siteId, siteId))
    .orderBy(asc(chatKnowledge.kind), asc(chatKnowledge.title))
}

export interface KnowledgeInput {
  id?: string
  kind: 'faq' | 'text'
  title: string
  body: string
  enabled: boolean
}

/** Adds or updates an entry. Its new updated_at is what makes the index task pick it up. */
export async function saveKnowledge(db: Db, siteId: string, input: KnowledgeInput): Promise<{ id: string; created: boolean }> {
  const values = { kind: input.kind, title: input.title, body: input.body, enabled: input.enabled, updatedAt: new Date().toISOString() }
  if (input.id) {
    const [row] = await db.update(chatKnowledge).set(values)
      .where(and(eq(chatKnowledge.id, input.id), eq(chatKnowledge.siteId, siteId)))
      .returning({ id: chatKnowledge.id })
    if (!row) notFound('That entry no longer exists')
    return { id: row.id, created: false }
  }
  const [n] = await db.select({ n: count() }).from(chatKnowledge).where(eq(chatKnowledge.siteId, siteId))
  if ((n?.n ?? 0) >= MAX_KNOWLEDGE_ENTRIES) validationError(`The chatbot can hold up to ${MAX_KNOWLEDGE_ENTRIES} entries. Remove some first.`)
  const id = ulid()
  await db.insert(chatKnowledge).values({ id, siteId, ...values })
  return { id, created: true }
}

export async function deleteKnowledge(db: Db, siteId: string, id: string): Promise<void> {
  const [row] = await db.delete(chatKnowledge).where(and(eq(chatKnowledge.id, id), eq(chatKnowledge.siteId, siteId))).returning({ id: chatKnowledge.id })
  if (!row) notFound('That entry no longer exists')
}

/** Recent visitor conversations, newest first (tests from the admin's "Try it" left out). */
export async function listConversations(db: Db, siteId: string, opts: { leadsOnly: boolean; limit: number; offset: number }): Promise<{ conversations: ChatConversationSummary[]; total: number }> {
  const where = and(
    eq(chatConversations.siteId, siteId),
    eq(chatConversations.isTest, false),
    sql`(${chatConversations.messageCount} > 0 OR ${chatConversations.leadAt} IS NOT NULL)`,
    opts.leadsOnly ? sql`${chatConversations.leadAt} IS NOT NULL` : undefined,
  )
  const first = db.select({ text: chatMessages.text }).from(chatMessages)
    .where(and(eq(chatMessages.conversationId, chatConversations.id), eq(chatMessages.role, 'user')))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
    .limit(1)
  const [rows, [total]] = await Promise.all([
    db.select({
      id: chatConversations.id,
      pagePath: chatConversations.pagePath,
      messageCount: chatConversations.messageCount,
      firstMessage: sql<string | null>`(${first})`,
      leadName: chatConversations.leadName,
      leadEmail: chatConversations.leadEmail,
      inboxThreadId: chatConversations.inboxThreadId,
      createdAt: chatConversations.createdAt,
      lastMessageAt: chatConversations.lastMessageAt,
    })
      .from(chatConversations)
      .where(where)
      .orderBy(desc(chatConversations.lastMessageAt))
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ n: count() }).from(chatConversations).where(where),
  ])
  return { conversations: rows.map(r => ({ ...r, firstMessage: r.firstMessage ?? '' })), total: total?.n ?? 0 }
}

export async function getTranscript(db: Db, siteId: string, conversationId: string): Promise<{ conversation: ChatConversationSummary; messages: ChatTranscriptMessage[] }> {
  const conversation = await db.query.chatConversations.findFirst({ where: and(eq(chatConversations.id, conversationId), eq(chatConversations.siteId, siteId)) })
  if (!conversation) notFound('That conversation no longer exists')
  const messages = await db.select({ id: chatMessages.id, role: chatMessages.role, text: chatMessages.text, sources: chatMessages.sources, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.siteId, siteId), eq(chatMessages.conversationId, conversationId)))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
  return {
    conversation: {
      id: conversation.id,
      pagePath: conversation.pagePath,
      messageCount: conversation.messageCount,
      firstMessage: messages.find(m => m.role === 'user')?.text ?? '',
      leadName: conversation.leadName,
      leadEmail: conversation.leadEmail,
      inboxThreadId: conversation.inboxThreadId,
      createdAt: conversation.createdAt,
      lastMessageAt: conversation.lastMessageAt,
    },
    messages,
  }
}

export async function deleteConversation(db: Db, siteId: string, id: string): Promise<void> {
  const [row] = await db.delete(chatConversations).where(and(eq(chatConversations.id, id), eq(chatConversations.siteId, siteId))).returning({ id: chatConversations.id })
  if (!row) notFound('That conversation no longer exists')
}
