import type { H3Event } from 'h3'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { chatChunks, chatConversations, chatMessages, emailMessages, mailboxes, sites, type ChatSource } from '@nuxflow/db/schema'
import { addressLine, BUSINESS_DAYS, dayName, formatSlots, openStatus, siteClock, statusText, upcomingExceptions, type BusinessInfo } from '@nuxflow/canvas/business'
import { useDb, type Db } from './db'
import { resolveSetting } from './settings'
import { planIncludes } from './hosting-plans'
import { getVectorizeIndex } from './cf-env'
import { embedText, getSearchIndexInfo } from './embeddings'
import { getBusinessInfo, hasBusinessDetails } from './business'
import { sha256Hex } from './buffer'
import { notifySiteRole } from './notify'
import { ensureInboundHandle, mailboxAddresses } from './inbox'
import { makeSnippet } from './inbound-email'
import { validationError } from './response'
import { CHATBOT_LIMITS, CHATBOT_SETTING_KEY, chatNamespace, parseChatbotSettings, splitLeadMarker, type ChatbotSettings } from '../../shared/lib/chatbot'

/**
 * The website chatbot: settings, what it finds for a question, conversations and leads.
 * Indexing (what it learns from the site) is chatbot-index.ts; the prompt is
 * chatbot-prompt.ts; the routes are /_nuxflow/chat (visitors) and /_nuxflow/chatbot (admin)
 * — not under /api, because another typed API address trips TS2589.
 *
 * Every model call uses `trigger: 'chat'`: platform-paid AI is charged to the plan's
 * "Chat AI credits a month" (and the platform's daily cap), the site's own key never.
 */

export const CHAT_RETENTION_DAYS = 30
/** Earlier turns sent with each question — enough for follow-ups, without paying for the whole chat. */
const HISTORY_TURNS = 6
/** Pieces of site text found per question, at most. */
const TOP_K = 6
/** Weakest similarity a passage may have to be used (bge cosine; tuned loosely, like smart search). */
const MIN_PASSAGE_SCORE = 0.4

export async function getChatbotSettings(event: H3Event): Promise<ChatbotSettings> {
  return parseChatbotSettings(await resolveSetting(event, CHATBOT_SETTING_KEY))
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1, 'Give the chatbot a name').max(CHATBOT_LIMITS.name),
  greeting: z.string().trim().max(CHATBOT_LIMITS.greeting),
  instructions: z.string().max(CHATBOT_LIMITS.instructions),
  avoid: z.string().max(CHATBOT_LIMITS.avoid),
  strict: z.boolean(),
  language: z.enum(['visitor', 'site']),
  contentTypes: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)).max(50),
  excludePaths: z.array(z.string().trim().max(200)).max(CHATBOT_LIMITS.excludePaths),
  starterQuestions: z.array(z.string().trim().max(CHATBOT_LIMITS.starterQuestion, 'Keep starter questions short')).max(CHATBOT_LIMITS.starterQuestions, `Up to ${CHATBOT_LIMITS.starterQuestions} starter questions`),
  showSources: z.boolean(),
  maxMessages: z.number().int().min(CHATBOT_LIMITS.minMessages).max(CHATBOT_LIMITS.maxMessages),
  lead: z.object({
    mode: z.enum(['fallback', 'always', 'off']),
    askPhone: z.boolean(),
    consentText: z.string().trim().max(CHATBOT_LIMITS.consentText),
  }),
})

/** Checks a `chatbot.settings` value sent to the settings PATCH (or restored). Throws a 422. */
export function normalizeChatbotSetting(value: unknown): ChatbotSettings {
  const result = settingsSchema.safeParse(value)
  if (!result.success) throw validationError(`Chatbot: ${result.error.issues[0]?.message ?? 'these settings aren\'t valid'}`)
  return parseChatbotSettings(result.data)
}

/** The hosting plan includes the chatbot (always true for self-hosters and sites without a plan). */
export async function chatbotIncluded(db: Db, siteId: string): Promise<boolean> {
  return planIncludes(db, siteId, 'chatbot')
}

// ── Visitor tokens and conversations ──────────────────────────────────────────────────

const TOKEN = /^[\w-]{24,128}$/

export function isChatToken(token: string): boolean {
  return TOKEN.test(token)
}

export type ChatConversationRow = typeof chatConversations.$inferSelect

/** The visitor's conversation (only theirs: the token must match), or a new one. */
export async function openConversation(db: Db, siteId: string, opts: { token: string; conversationId?: string; path: string; isTest: boolean }): Promise<ChatConversationRow> {
  const tokenHash = await sha256Hex(opts.token)
  if (opts.conversationId) {
    const existing = await db.query.chatConversations.findFirst({
      where: and(eq(chatConversations.id, opts.conversationId), eq(chatConversations.siteId, siteId), eq(chatConversations.visitorTokenHash, tokenHash)),
    })
    if (existing) return existing
  }
  const [row] = await db.insert(chatConversations).values({
    id: ulid(),
    siteId,
    visitorTokenHash: tokenHash,
    pagePath: opts.path.slice(0, 500) || '/',
    isTest: opts.isTest,
  }).returning()
  return row!
}

/** The last few turns, oldest first, for the model. */
export async function conversationHistory(db: Db, siteId: string, conversationId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const rows = await db.select({ role: chatMessages.role, text: chatMessages.text })
    .from(chatMessages)
    .where(and(eq(chatMessages.siteId, siteId), eq(chatMessages.conversationId, conversationId)))
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(HISTORY_TURNS)
  return rows.reverse().map(r => ({ role: r.role, content: r.text }))
}

export async function saveChatMessage(db: Db, siteId: string, conversationId: string, role: 'user' | 'assistant', text: string, sources: ChatSource[] | null = null): Promise<void> {
  // ULIDs made in the same millisecond still sort in order of creation within this isolate.
  await db.batch([
    db.insert(chatMessages).values({ id: ulid(), siteId, conversationId, role, text, sources }),
    db.update(chatConversations)
      .set({
        lastMessageAt: sql`(datetime('now'))`,
        ...(role === 'user' && { messageCount: sql`${chatConversations.messageCount} + 1` }),
      })
      .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.siteId, siteId))),
  ])
}

// ── What the bot finds for a question ─────────────────────────────────────────────────

export interface ChatPassage { title: string; path: string | null; text: string }

/**
 * The pieces of the site's text most like the question, from the chat namespace of the
 * shared Vectorize index (chatbot-index.ts fills it). Empty when there's no index, no AI,
 * nothing close enough, or the chat allowance is used up (the embedding is refused) —
 * the bot then answers from the business details alone, or says it doesn't know.
 */
export async function findPassages(event: H3Event, siteId: string, question: string): Promise<ChatPassage[]> {
  const index = getVectorizeIndex(event)
  if (!index) return []
  try {
    const values = await embedText(event, question, 'chat')
    if (!values) return []
    const result = await index.query(values, { topK: TOP_K, namespace: chatNamespace(siteId) })
    const ids = result.matches.filter(m => m.score >= MIN_PASSAGE_SCORE).map(m => m.id)
    if (!ids.length) return []
    const rows = await useDb(event).select({ id: chatChunks.id, title: chatChunks.title, path: chatChunks.path, text: chatChunks.text })
      .from(chatChunks)
      .where(and(eq(chatChunks.siteId, siteId), inArray(chatChunks.id, ids)))
    const byId = new Map(rows.map(r => [r.id, r]))
    // Vectorize's order (most similar first); a vector whose row is gone is skipped.
    return ids.flatMap((id) => {
      const r = byId.get(id)
      return r ? [{ title: r.title, path: r.path, text: r.text }] : []
    })
  }
  catch (err) {
    console.error('[chatbot] Finding passages failed:', err)
    return []
  }
}

/** Distinct pages an answer drew on, for the source links. Knowledge entries have no page. */
export function passageSources(passages: ChatPassage[]): ChatSource[] {
  const seen = new Set<string>()
  const out: ChatSource[] = []
  for (const p of passages) {
    if (!p.path || seen.has(p.path)) continue
    seen.add(p.path)
    out.push({ title: p.title, path: p.path })
  }
  return out.slice(0, 3)
}

// ── Business details as plain facts ───────────────────────────────────────────────────

/** Settings → Business written out for the prompt, read live so hours are never stale. */
export function businessFactsText(info: BusinessInfo | null, siteName: string, timeZone: string, locale: string, now: Date): string {
  if (!hasBusinessDetails(info)) return ''
  const lines: string[] = [`Name: ${info.name || siteName}`]
  const address = addressLine(info)
  if (address) lines.push(`Address: ${address}`)
  if (info.phone) lines.push(`Phone: ${info.phone}`)
  if (info.email) lines.push(`Email: ${info.email}`)
  if (info.priceRange) lines.push(`Price range: ${info.priceRange}`)
  const hours = BUSINESS_DAYS.map(d => `${dayName(d, 'en')}: ${info.hours[d].length ? formatSlots(info.hours[d], locale) : 'closed'}`)
  if (BUSINESS_DAYS.some(d => info.hours[d].length)) lines.push(`Opening hours (${timeZone}):\n${hours.map(h => `  ${h}`).join('\n')}`)
  if (info.hoursNote) lines.push(`About the hours: ${info.hoursNote}`)
  const special = upcomingExceptions(info, siteClock(now, timeZone).date, 5)
  if (special.length) {
    lines.push(`Special dates:\n${special.map(e => `  ${e.date}: ${e.slots.length ? formatSlots(e.slots, locale) : 'closed'}${e.note ? ` (${e.note})` : ''}`).join('\n')}`)
  }
  const status = openStatus(info, timeZone, now)
  if (status) lines.push(`Right now: ${statusText(status, 'en')}`)
  return lines.join('\n')
}

export async function siteBusinessFacts(event: H3Event, site: { name: string; timezone: string; locale: string }, now = new Date()): Promise<string> {
  return businessFactsText(await getBusinessInfo(event), site.name, site.timezone || 'UTC', site.locale || 'en', now)
}

export function siteLanguageName(locale: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale
  }
  catch {
    return locale
  }
}

export function siteNow(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now)
  }
  catch {
    return now.toISOString()
  }
}

/** The stored reply: the lead marker taken out, kept short of D1's row limits. */
export function storedReply(text: string): { text: string; wantsLead: boolean } {
  const { text: clean, wantsLead } = splitLeadMarker(text)
  return { text: clean.slice(0, 8000), wantsLead }
}

// ── Leads into the Inbox ──────────────────────────────────────────────────────────────

/** The Inbox mailbox chat enquiries land in, made the first time one arrives. */
export const CHAT_MAILBOX_LOCAL_PART = 'chat'

async function chatMailbox(event: H3Event, db: Db, siteId: string): Promise<{ id: string; address: string }> {
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } })
  const domain = site?.domain ?? ''
  let mailbox = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.siteId, siteId), eq(mailboxes.localPart, CHAT_MAILBOX_LOCAL_PART)) })
  if (!mailbox) {
    // notify off: the chat.lead notification below says more than "new email" would.
    await db.insert(mailboxes).values({ id: ulid(), siteId, localPart: CHAT_MAILBOX_LOCAL_PART, name: 'Website chat', kind: 'inbox', notify: false })
      .onConflictDoNothing()
    mailbox = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.siteId, siteId), eq(mailboxes.localPart, CHAT_MAILBOX_LOCAL_PART)) })
  }
  // Where a reply from the Inbox should come from, and the visitor's answer go back to: the
  // site's own address, or its platform alias when the deployment has a shared inbound
  // domain (a site whose domain isn't on Email Routing receives mail there).
  const handle = await ensureInboundHandle(event, db, siteId).catch(() => null)
  const { siteAddress, platformAddress } = mailboxAddresses(CHAT_MAILBOX_LOCAL_PART, domain, handle)
  return { id: mailbox!.id, address: platformAddress ?? siteAddress }
}

export interface ChatLeadInput {
  name: string
  email: string
  phone?: string
  message?: string
}

/**
 * The visitor's details and the conversation so far, as a new thread in Admin → Inbox
 * ("Website chat"), categorised as a lead. Replying there emails the visitor. The team is
 * told with a `chat.lead` notification.
 */
export async function recordChatLead(event: H3Event, siteId: string, conversation: ChatConversationRow, lead: ChatLeadInput): Promise<{ threadId: string }> {
  const db = useDb(event)
  const mailbox = await chatMailbox(event, db, siteId)
  const messages = await db.select({ role: chatMessages.role, text: chatMessages.text })
    .from(chatMessages)
    .where(and(eq(chatMessages.siteId, siteId), eq(chatMessages.conversationId, conversation.id)))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
    .limit(200)

  const transcript = messages.map(m => `${m.role === 'user' ? 'Visitor' : 'Chatbot'}: ${m.text}`).join('\n\n')
  const details = [
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    lead.phone ? `Phone: ${lead.phone}` : null,
    `Page: ${conversation.pagePath}`,
  ].filter(Boolean).join('\n')
  const text = [lead.message ? `${lead.message}\n` : null, details, transcript ? `\n— Conversation —\n\n${transcript}` : null].filter(Boolean).join('\n').slice(0, 100_000)
  const firstQuestion = messages.find(m => m.role === 'user')?.text ?? lead.message ?? ''
  const subject = `Website chat: ${firstQuestion ? firstQuestion.slice(0, 80) : lead.name}`

  // One enquiry per conversation: asking again adds to the same thread.
  const id = ulid()
  const threadId = conversation.inboxThreadId ?? id
  await db.batch([
    db.insert(emailMessages).values({
      id,
      siteId,
      mailboxId: mailbox.id,
      threadId,
      direction: 'inbound',
      fromAddress: lead.email,
      fromName: lead.name,
      toAddress: mailbox.address,
      subject,
      snippet: makeSnippet(lead.message || firstQuestion || details),
      textBody: text,
      category: 'lead',
      aiSummary: lead.message ? lead.message.slice(0, 200) : null,
      size: text.length,
    }),
    db.update(chatConversations)
      .set({ leadName: lead.name, leadEmail: lead.email, leadAt: sql`(datetime('now'))`, inboxThreadId: threadId })
      .where(and(eq(chatConversations.id, conversation.id), eq(chatConversations.siteId, siteId))),
  ])

  await notifySiteRole(event, {
    siteId,
    minRole: 'editor',
    type: 'chat.lead',
    title: `Chat enquiry from ${lead.name}`,
    body: `${lead.name} <${lead.email}> left their details in the website chat${firstQuestion ? `: ${makeSnippet(firstQuestion)}` : '.'}`,
    data: { emailMessageId: id, threadId },
    sendEmailNotification: true,
    sendPush: true,
    pushUrl: `/admin/inbox?message=${id}`,
    actionLabel: 'Open in inbox',
  }).catch(err => console.error('[chatbot] Lead notification failed:', err))

  return { threadId }
}

/** Whether the deployment can index anything at all (Vectorize + an embedding model). */
export async function chatIndexAvailable(event: H3Event): Promise<boolean> {
  if (!getVectorizeIndex(event)) return false
  return !!(await getSearchIndexInfo(event))?.model
}
