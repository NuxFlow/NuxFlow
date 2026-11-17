import type { H3Event } from 'h3'
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { chatConversations, chatKnowledge, chatMessages } from '@nuxflow/db/schema'
import type { Db } from './db'
import { getWorkersAiBinding } from './cf-env'
import { httpError, notFound, validationError } from './response'
import {
  CHAT_DOCUMENT_LIMITS, CHAT_DOCUMENT_TYPES, chatDocumentExtension,
  type ChatConversationSummary, type ChatInsightItem, type ChatInsightsResponse, type ChatKnowledgeEntry, type ChatKnowledgeKind, type ChatTranscriptMessage,
} from '../../shared/lib/chatbot'

/** Admin → Chatbot: knowledge entries, documents, transcripts and Insights (server/utils/chatbot.ts has the rest). */

export const MAX_KNOWLEDGE_ENTRIES = 500
export const KNOWLEDGE_TITLE_MAX = 300
/** The longest text any entry may hold — a document's. Q&A and free text stop at CHAT_DOCUMENT_LIMITS.entryChars. */
export const KNOWLEDGE_BODY_MAX = CHAT_DOCUMENT_LIMITS.chars

export async function listKnowledge(db: Db, siteId: string): Promise<ChatKnowledgeEntry[]> {
  return db.select({
    id: chatKnowledge.id,
    kind: chatKnowledge.kind,
    title: chatKnowledge.title,
    body: chatKnowledge.body,
    enabled: chatKnowledge.enabled,
    fileName: chatKnowledge.fileName,
    fileSize: chatKnowledge.fileSize,
    updatedAt: chatKnowledge.updatedAt,
  })
    .from(chatKnowledge)
    .where(eq(chatKnowledge.siteId, siteId))
    .orderBy(asc(chatKnowledge.kind), asc(chatKnowledge.title))
}

export interface KnowledgeInput {
  id?: string
  kind: ChatKnowledgeKind
  title: string
  body: string
  enabled: boolean
  fileName?: string | null
  fileSize?: number | null
}

/** Adds or updates an entry. Its new updated_at is what makes the index task pick it up. */
export async function saveKnowledge(db: Db, siteId: string, input: KnowledgeInput): Promise<{ id: string; created: boolean }> {
  // Q&A and free text are short; only a document (from an upload) holds a long text.
  const max = input.kind === 'document' ? CHAT_DOCUMENT_LIMITS.chars : CHAT_DOCUMENT_LIMITS.entryChars
  if (input.body.length > max) validationError(`That's too long: up to ${max.toLocaleString('en')} characters.`)
  const values = {
    kind: input.kind,
    title: input.title,
    body: input.body,
    enabled: input.enabled,
    ...(input.fileName !== undefined && { fileName: input.fileName }),
    ...(input.fileSize !== undefined && { fileSize: input.fileSize }),
    updatedAt: new Date().toISOString(),
  }
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
  const messages = await db.select({
    id: chatMessages.id,
    role: chatMessages.role,
    text: chatMessages.text,
    sources: chatMessages.sources,
    unanswered: chatMessages.unanswered,
    rating: chatMessages.rating,
    createdAt: chatMessages.createdAt,
  })
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

// ── Documents ─────────────────────────────────────────────────────────────────────────

export interface ChatDocumentFile { name: string; type: string; data: Uint8Array }

/**
 * The text of an uploaded file, for a `document` knowledge entry. Plain text is read as it
 * is; PDFs, Word, spreadsheets and web pages go through Workers AI's document conversion
 * (`env.AI.toMarkdown()`, which costs nothing for these formats — images, which would run
 * a model, aren't accepted). The file itself isn't kept: only its text, cut to
 * CHAT_DOCUMENT_LIMITS.chars.
 */
export async function chatDocumentText(event: H3Event, file: ChatDocumentFile): Promise<{ text: string; truncated: boolean }> {
  const ext = chatDocumentExtension(file.name)
  if (!ext) validationError(`That kind of file can't be read. Upload one of: ${Object.keys(CHAT_DOCUMENT_TYPES).map(e => `.${e}`).join(', ')}.`)
  if (file.data.byteLength > CHAT_DOCUMENT_LIMITS.bytes) httpError({ status: 413, message: 'That file is too big: up to 10 MB.' })
  if (!file.data.byteLength) validationError('That file is empty.')

  let text: string
  if (CHAT_DOCUMENT_TYPES[ext]!.plain) {
    text = new TextDecoder('utf-8', { fatal: false }).decode(file.data)
  }
  else {
    const ai = getWorkersAiBinding(event)
    if (!ai || typeof ai.toMarkdown !== 'function') {
      httpError({ status: 503, message: 'Reading PDF and Office files needs Workers AI (the [ai] binding in wrangler.toml). Plain text, Markdown and CSV files work without it.' })
    }
    const blob = new Blob([file.data as BlobPart], { type: file.type || 'application/octet-stream' })
    const result = await ai.toMarkdown({ name: file.name, blob })
    if (result.format === 'error') validationError(`That file couldn't be read: ${result.error}`)
    text = result.data
  }
  // Tidy: no NUL bytes, no runs of blank lines.
  text = text.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) validationError('There is no text in that file the chatbot can learn from. A scanned PDF holds only pictures of text.')
  const truncated = text.length > CHAT_DOCUMENT_LIMITS.chars
  return { text: truncated ? text.slice(0, CHAT_DOCUMENT_LIMITS.chars) : text, truncated }
}

/** "price-list_2026.pdf" → "price list 2026". */
export function documentTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (base || 'Document').slice(0, KNOWLEDGE_TITLE_MAX)
}

// ── Insights ──────────────────────────────────────────────────────────────────────────

const INSIGHT_ITEMS = 50

/**
 * The last 30 days (as long as conversations are kept): how many conversations, questions,
 * leads and thumbs, and the answers that need a look — ones the bot couldn't help with, and
 * ones a visitor said weren't helpful — that nobody has dealt with yet. Each comes with the
 * visitor's question it answered, for "Add an answer".
 */
export async function chatInsights(db: Db, siteId: string): Promise<ChatInsightsResponse> {
  const live = and(eq(chatConversations.siteId, siteId), eq(chatConversations.isTest, false))
  const answerOf = and(eq(chatMessages.siteId, siteId), eq(chatMessages.role, 'assistant'), eq(chatConversations.isTest, false))
  const [[convos], [answers], rows] = await Promise.all([
    db.select({
      conversations: sql<number>`count(*)`,
      questions: sql<number>`coalesce(sum(${chatConversations.messageCount}), 0)`,
      leads: sql<number>`coalesce(sum(case when ${chatConversations.leadAt} is not null then 1 else 0 end), 0)`,
    }).from(chatConversations).where(and(live, sql`(${chatConversations.messageCount} > 0 OR ${chatConversations.leadAt} IS NOT NULL)`)),
    db.select({
      helpful: sql<number>`coalesce(sum(case when ${chatMessages.rating} = 1 then 1 else 0 end), 0)`,
      unhelpful: sql<number>`coalesce(sum(case when ${chatMessages.rating} = -1 then 1 else 0 end), 0)`,
      unanswered: sql<number>`coalesce(sum(case when ${chatMessages.unanswered} = 1 then 1 else 0 end), 0)`,
    }).from(chatMessages).innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId)).where(answerOf),
    db.select({
      messageId: chatMessages.id,
      conversationId: chatMessages.conversationId,
      answer: chatMessages.text,
      rating: chatMessages.rating,
      createdAt: chatMessages.createdAt,
    })
      .from(chatMessages)
      .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
      .where(and(answerOf, isNull(chatMessages.reviewedAt), or(eq(chatMessages.unanswered, true), eq(chatMessages.rating, -1))))
      .orderBy(desc(chatMessages.createdAt))
      .limit(INSIGHT_ITEMS),
  ])

  // The question each answer replied to: the visitor's last message before it.
  const convoIds = [...new Set(rows.map(r => r.conversationId))]
  const questions = convoIds.length
    ? await db.select({ id: chatMessages.id, conversationId: chatMessages.conversationId, text: chatMessages.text, createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(and(eq(chatMessages.siteId, siteId), eq(chatMessages.role, 'user'), inArray(chatMessages.conversationId, convoIds)))
        .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
    : []
  const items: ChatInsightItem[] = rows.map((r) => {
    // ULIDs sort in creation order, so "before this answer" is a smaller id.
    const before = questions.filter(q => q.conversationId === r.conversationId && q.id < r.messageId)
    return {
      messageId: r.messageId,
      conversationId: r.conversationId,
      question: before.at(-1)?.text ?? '',
      answer: r.answer,
      reason: r.rating === -1 ? 'unhelpful' : 'unanswered',
      createdAt: r.createdAt,
    }
  })
  return {
    totals: {
      conversations: Number(convos?.conversations ?? 0),
      questions: Number(convos?.questions ?? 0),
      leads: Number(convos?.leads ?? 0),
      helpful: Number(answers?.helpful ?? 0),
      unhelpful: Number(answers?.unhelpful ?? 0),
      unanswered: Number(answers?.unanswered ?? 0),
    },
    items,
  }
}

/** Takes an answer off the Insights list (an answer was added for it, or it's not worth one). */
export async function reviewChatAnswer(db: Db, siteId: string, messageId: string): Promise<void> {
  const [row] = await db.update(chatMessages).set({ reviewedAt: new Date().toISOString() })
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.siteId, siteId), eq(chatMessages.role, 'assistant')))
    .returning({ id: chatMessages.id })
  if (!row) notFound('That answer no longer exists')
}
