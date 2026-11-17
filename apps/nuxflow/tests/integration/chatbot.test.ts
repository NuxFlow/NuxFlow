/**
 * The website chatbot (server/utils/chatbot*.ts): what it learns (the index sync and its
 * change detection), the visitor route (streamed answers, limits, leads into the Inbox),
 * the admin route, the plan feature, retention and site deletion.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { ulid } from 'ulid'
import { chatChunks, chatConversations, chatKnowledge, chatMessages, contentItems, emailMessages, hostingPlans, mailboxes, notifications, siteSettings, sites } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedSetting } from '../helpers/seed'
import type * as CfEnv from '../../server/utils/cf-env'
import type * as AiSdk from '../../server/utils/ai-sdk'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))

// An in-memory Vectorize index: every vector in the queried namespace matches.
const vectors = new Map<string, { namespace?: string }>()
const fakeIndex = {
  upsert: vi.fn(async (list: { id: string; namespace?: string }[]) => {
    for (const v of list) vectors.set(v.id, { namespace: v.namespace })
  }),
  deleteByIds: vi.fn(async (ids: string[]) => {
    for (const id of ids) vectors.delete(id)
  }),
  query: vi.fn(async (_values: number[], opts: { topK: number; namespace?: string }) => ({
    matches: [...vectors.entries()].filter(([, v]) => v.namespace === opts.namespace).slice(0, opts.topK).map(([id]) => ({ id, score: 0.9 })),
  })),
  describe: async () => ({ dimensions: 3 }),
}
vi.mock('../../server/utils/cf-env', async (importOriginal) => {
  const original = await importOriginal<typeof CfEnv>()
  return { ...original, getVectorizeIndex: () => fakeIndex }
})
const TEST_MODEL = { id: '@cf/test-embed', multilingual: true }
const embedTexts = vi.fn(async (_e: unknown, texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]))
vi.mock('../../server/utils/embeddings', () => ({
  getSearchIndexInfo: async () => ({ dimensions: 3, model: TEST_MODEL, vectorCount: 0 }),
  embedTextsForRebuild: (e: unknown, texts: string[]) => embedTexts(e, texts),
  embedText: async () => [0.1, 0.2, 0.3],
  upsertContentEmbedding: vi.fn(),
  deleteContentEmbedding: vi.fn(),
  deleteContentEmbeddings: vi.fn(),
}))

// The model the chat answers with: streams `answer` in two pieces.
let answer = 'We open at 9. [[CONTACT]]'
function streamingModel() {
  const half = Math.floor(answer.length / 2)
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: answer.slice(0, half) },
          { type: 'text-delta', id: 't', delta: answer.slice(half) },
          { type: 'text-end', id: 't' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 100 }, outputTokens: { total: 20 } } },
        ],
      }),
    }),
  })
}
const lastPrompt = vi.fn()
vi.mock('../../server/utils/ai-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof AiSdk>()
  return {
    ...original,
    requireAiSdkModel: async (_e: unknown, _q: unknown, opts: { trigger?: string }) => {
      lastPrompt(opts)
      return streamingModel()
    },
    getAiSdkModel: async () => streamingModel(),
  }
})
// h3's createEvent isn't usable under Vitest; same stand-in as hosting-plans.test.ts.
vi.mock('../../server/utils/system-event', () => ({
  createSystemEvent: (opts: { env: unknown; siteId?: string; host?: string }) => {
    const event = createMockEvent({ siteId: opts.siteId, headers: { host: opts.host ?? 'localhost' } }) as unknown as { context: Record<string, unknown> }
    event.context.cloudflare = { env: opts.env, context: { waitUntil: (p: Promise<unknown>) => { void p } } }
    return event
  },
}))

const { sitesNeedingChatIndex, syncSiteChatIndex, deleteChatVectors, CHATBOT_INDEX_STAMP_KEY } = await import('../../server/utils/chatbot-index')
const { indexChatbots } = await import('../../server/scheduled/chatbot-index')
const { getChatbotSettings, normalizeChatbotSetting } = await import('../../server/utils/chatbot')
const { clearHostingPlanCache } = await import('../../server/utils/hosting-plans')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { clearSiteInfoCache } = await import('../../server/utils/site-info')
const { resetUsageBuffer } = await import('../../server/utils/usage')
const { saveSetting } = await import('../../server/utils/settings')
const { default: chatRoute } = await import('../../server/routes/_nuxflow/chat.post')
const { default: adminGet } = await import('../../server/routes/_nuxflow/chatbot.get')
const { default: adminPost } = await import('../../server/routes/_nuxflow/chatbot.post')
const { default: patchSettings } = await import('../../server/api/v1/settings/index.patch')
const { pruneOldData } = await import('../../server/scheduled/prune-old-data')
const { DEFAULT_CHATBOT_SETTINGS, CHATBOT_SETTING_KEY } = await import('../../shared/lib/chatbot')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-chat-01'
const PRIMARY = 'site-chat-primary'
const db = () => getCurrentTestDb()
const TOKEN = 'visitor-token-aaaaaaaaaaaaaaaaaaaa'
let adminId: string
let editorId: string
let pageType: string

function ev(opts: { userId?: string; body?: unknown; query?: Record<string, string>; site?: string; fetchSite?: string } = {}): H3Event {
  const event = createMockEvent({
    siteId: opts.site ?? SITE,
    session: opts.userId ? { user: { id: opts.userId, name: 'Staff', email: 'staff@chat.test' } } : undefined,
    body: opts.body,
    query: opts.query,
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: { 'host': 'chat.test', 'sec-fetch-site': opts.fetchSite ?? 'same-origin' },
  }) as unknown as { context: Record<string, unknown> }
  event.context.cloudflare = { env: { AI: {}, VECTORIZE: fakeIndex }, context: { waitUntil: (p: Promise<unknown>) => { void p } } }
  return event as unknown as H3Event
}

async function setChatbot(patch: Partial<typeof DEFAULT_CHATBOT_SETTINGS> = {}) {
  const value = { ...DEFAULT_CHATBOT_SETTINGS, enabled: true, ...patch }
  // saveSetting() also drops the cached copy.
  await saveSetting(ev(), CHATBOT_SETTING_KEY, value)
  return value
}

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

async function readStream(stream: unknown): Promise<string> {
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out + decoder.decode()
}

async function sync() {
  const settings = await getChatbotSettings(ev())
  return syncSiteChatIndex(ev(), db(), SITE, settings)
}

beforeAll(async () => {
  await initTestDb()
  await seedSite(db(), { id: PRIMARY, domain: 'primary.chat.test', isPrimary: true })
  await seedSite(db(), { id: SITE, domain: 'chat.test', name: 'Rose Café' })
  adminId = await seedUser(db(), { email: 'admin@chat.test' })
  editorId = await seedUser(db(), { email: 'editor@chat.test' })
  await seedRole(db(), adminId, SITE, 'admin')
  await seedRole(db(), editorId, SITE, 'editor')
  pageType = await seedContentType(db(), SITE, { slug: 'page', name: 'Pages' })
})
afterAll(() => teardownTestDb())
beforeEach(async () => {
  resetUsageBuffer()
  clearSiteInfoCache()
  answer = 'We open at 9. [[CONTACT]]'
  await setChatbot()
})

describe('what the chatbot learns', () => {
  it('learns published public pages and knowledge, into its own namespace', async () => {
    const page = await seedContentItem(db(), SITE, pageType, { title: 'Opening hours', content: doc('We open at nine every day.') })
    await seedContentItem(db(), SITE, pageType, { title: 'Draft', status: 'draft', content: doc('Secret plans.') })
    await seedContentItem(db(), SITE, pageType, { title: 'Members', visibility: 'members', content: doc('Members only.') })
    await (adminPost as Handler)(ev({ userId: adminId, body: { action: 'knowledge-save', kind: 'faq', title: 'Do you deliver?', body: 'Yes, within 5 miles.' } }))

    const candidates = await sitesNeedingChatIndex(ev(), db())
    expect(candidates.map(c => c.siteId)).toEqual([SITE])
    const result = await sync()
    expect(result).toMatchObject({ done: true })

    const rows = await db().select().from(chatChunks).where(eq(chatChunks.siteId, SITE))
    expect(rows.map(r => r.title).sort()).toEqual(['Do you deliver?', 'Opening hours'])
    expect(rows.find(r => r.sourceId === page)?.text).toContain('We open at nine')
    expect(rows.find(r => r.sourceKind === 'knowledge')?.text).toContain('A: Yes, within 5 miles.')
    expect(rows.every(r => vectors.get(r.id)?.namespace === `chat:${SITE}`)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('Secret plans')
    expect(JSON.stringify(rows)).not.toContain('Members only')
  })

  it('remembers what it covered, and only looks again when something changes', async () => {
    // The task records the stamp after a complete sync.
    await indexChatbots({ env: { AI: {}, VECTORIZE: fakeIndex } } as never)
    expect(await db().query.siteSettings.findFirst({ where: and(eq(siteSettings.siteId, SITE), eq(siteSettings.key, CHATBOT_INDEX_STAMP_KEY)) })).toBeTruthy()
    expect(await sitesNeedingChatIndex(ev(), db())).toEqual([])

    // Saved again with the same text: noticed, but not embedded again.
    const [page] = await db().select().from(contentItems).where(and(eq(contentItems.siteId, SITE), eq(contentItems.title, 'Opening hours')))
    await db().update(contentItems).set({ updatedAt: new Date(Date.now() + 1000).toISOString() }).where(eq(contentItems.id, page!.id))
    expect((await sitesNeedingChatIndex(ev(), db())).length).toBe(1)
    embedTexts.mockClear()
    expect(await sync()).toMatchObject({ done: true, embedded: 0 })
    expect(embedTexts).not.toHaveBeenCalled()

    // Changed text: the old chunks and vectors are replaced.
    const before = await db().select({ id: chatChunks.id }).from(chatChunks).where(eq(chatChunks.sourceId, page!.id))
    await db().update(contentItems).set({ content: doc('Now we open at ten.'), updatedAt: new Date(Date.now() + 2000).toISOString() }).where(eq(contentItems.id, page!.id))
    await sync()
    const after = await db().select().from(chatChunks).where(eq(chatChunks.sourceId, page!.id))
    expect(after[0]!.text).toContain('ten')
    for (const old of before) {
      expect(vectors.has(old.id)).toBe(false)
      expect(after.some(r => r.id === old.id)).toBe(false)
    }
  })

  it('forgets a page once it is unpublished, and follows the content-type filter', async () => {
    const [page] = await db().select().from(contentItems).where(and(eq(contentItems.siteId, SITE), eq(contentItems.title, 'Opening hours')))
    const ids = (await db().select({ id: chatChunks.id }).from(chatChunks).where(eq(chatChunks.sourceId, page!.id))).map(r => r.id)
    await db().update(contentItems).set({ status: 'draft', updatedAt: new Date(Date.now() + 3000).toISOString() }).where(eq(contentItems.id, page!.id))
    await sync()
    expect(await db().select().from(chatChunks).where(eq(chatChunks.sourceId, page!.id))).toEqual([])
    for (const id of ids) expect(vectors.has(id)).toBe(false)
    await db().update(contentItems).set({ status: 'published', updatedAt: new Date(Date.now() + 4000).toISOString() }).where(eq(contentItems.id, page!.id))

    await setChatbot({ contentTypes: ['post'] })
    await sync()
    expect(await db().select().from(chatChunks).where(and(eq(chatChunks.siteId, SITE), eq(chatChunks.sourceKind, 'content')))).toEqual([])
    await setChatbot()
    await sync()
    expect((await db().select().from(chatChunks).where(and(eq(chatChunks.siteId, SITE), eq(chatChunks.sourceKind, 'content')))).length).toBeGreaterThan(0)
  })

  it('is skipped while the bubble is off', async () => {
    await setChatbot({ enabled: false })
    expect(await sitesNeedingChatIndex(ev(), db())).toEqual([])
  })
})

describe('answering visitors', () => {
  it('streams the answer, stores both sides, and passes the sources in a header', async () => {
    const event = ev({ body: { action: 'message', token: TOKEN, message: 'When do you open?', path: '/about' } })
    const stream = await (chatRoute as Handler)(event)
    const text = await readStream(stream)
    expect(text).toBe(answer)
    expect(lastPrompt).toHaveBeenLastCalledWith(expect.objectContaining({ trigger: 'chat' }))

    const headers = (event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders
    const conversationId = headers['x-chat-conversation']!
    expect(JSON.parse(decodeURIComponent(headers['x-chat-sources']!))).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Opening hours' })]))

    const messages = await db().select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId))
    expect(messages.map(m => [m.role, m.text])).toEqual([['user', 'When do you open?'], ['assistant', 'We open at 9.']])
    const convo = await db().query.chatConversations.findFirst({ where: eq(chatConversations.id, conversationId) })
    expect(convo).toMatchObject({ messageCount: 1, pagePath: '/about', isTest: false })
  })

  it('continues only the visitor\'s own conversation', async () => {
    const first = ev({ body: { action: 'message', token: TOKEN, message: 'Hi' } })
    await readStream(await (chatRoute as Handler)(first))
    const id = (first as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['x-chat-conversation']
    const other = ev({ body: { action: 'message', token: 'someone-else-bbbbbbbbbbbbbbbbbbbb', conversationId: id, message: 'Hijack' } })
    await readStream(await (chatRoute as Handler)(other))
    expect((other as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['x-chat-conversation']).not.toBe(id)
  })

  it('stops at the message limit', async () => {
    await setChatbot({ maxMessages: 2 })
    let id: string | undefined
    for (let i = 0; i < 2; i++) {
      const e = ev({ body: { action: 'message', token: TOKEN, conversationId: id, message: `Q${i}` } })
      await readStream(await (chatRoute as Handler)(e))
      id = (e as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['x-chat-conversation']
    }
    await expect((chatRoute as Handler)(ev({ body: { action: 'message', token: TOKEN, conversationId: id, message: 'Q3' } })))
      .rejects.toMatchObject({ statusCode: 429, data: { code: 'chat_limit' } })
  })

  it('refuses when it is off, from another site, or with a bad token', async () => {
    await expect((chatRoute as Handler)(ev({ fetchSite: 'cross-site', body: { action: 'message', token: TOKEN, message: 'Hi' } }))).rejects.toMatchObject({ statusCode: 403 })
    await expect((chatRoute as Handler)(ev({ body: { action: 'message', token: 'short', message: 'Hi' } }))).rejects.toMatchObject({ statusCode: 422 })
    await setChatbot({ enabled: false })
    await expect((chatRoute as Handler)(ev({ body: { action: 'message', token: TOKEN, message: 'Hi' } }))).rejects.toMatchObject({ statusCode: 404 })
    // …but the admin can still try it out, and that's kept out of Conversations.
    const e = ev({ userId: adminId, body: { action: 'message', token: TOKEN, message: 'Test question', test: true } })
    await readStream(await (chatRoute as Handler)(e))
    const list = await (adminGet as Handler)(ev({ userId: adminId, query: { view: 'conversations' } })) as { conversations: { firstMessage: string }[] }
    expect(list.conversations.map(c => c.firstMessage)).not.toContain('Test question')
    // A visitor can't use the test switch.
    await expect((chatRoute as Handler)(ev({ body: { action: 'message', token: TOKEN, message: 'Hi', test: true } }))).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('leads', () => {
  it('puts the visitor\'s details and the conversation in the Inbox, and tells the team', async () => {
    const e = ev({ body: { action: 'message', token: TOKEN, message: 'Can you cater a wedding?' } })
    await readStream(await (chatRoute as Handler)(e))
    const conversationId = (e as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['x-chat-conversation']

    await (chatRoute as Handler)(ev({ body: { action: 'lead', token: TOKEN, conversationId, name: 'Ann Lee', email: 'ANN@example.com', phone: '0123', message: 'For 80 people' } }))

    const mailbox = await db().query.mailboxes.findFirst({ where: and(eq(mailboxes.siteId, SITE), eq(mailboxes.localPart, 'chat')) })
    expect(mailbox).toMatchObject({ name: 'Website chat', kind: 'inbox' })
    const [msg] = await db().select().from(emailMessages).where(and(eq(emailMessages.siteId, SITE), eq(emailMessages.mailboxId, mailbox!.id)))
    expect(msg).toMatchObject({ fromAddress: 'ann@example.com', fromName: 'Ann Lee', category: 'lead', direction: 'inbound', status: 'new' })
    expect(msg!.textBody).toContain('For 80 people')
    expect(msg!.textBody).toContain('Visitor: Can you cater a wedding?')
    expect(msg!.textBody).not.toContain('0123') // phone only when the settings ask for it
    const convo = await db().query.chatConversations.findFirst({ where: eq(chatConversations.id, conversationId!) })
    expect(convo).toMatchObject({ leadEmail: 'ann@example.com', inboxThreadId: msg!.threadId })
    const notes = await db().select().from(notifications).where(and(eq(notifications.type, 'chat.lead'), eq(notifications.userId, editorId)))
    expect(notes).toHaveLength(1)
  })

  it('quietly drops a bot that fills in the honeypot, and refuses when leads are off', async () => {
    const before = (await db().select().from(emailMessages).where(eq(emailMessages.siteId, SITE))).length
    await expect((chatRoute as Handler)(ev({ body: { action: 'lead', token: TOKEN, name: 'Bot', email: 'bot@example.com', website: 'spam.example' } }))).resolves.toEqual({ ok: true })
    expect((await db().select().from(emailMessages).where(eq(emailMessages.siteId, SITE))).length).toBe(before)
    await setChatbot({ lead: { ...DEFAULT_CHATBOT_SETTINGS.lead, mode: 'off' } })
    await expect((chatRoute as Handler)(ev({ body: { action: 'lead', token: TOKEN, name: 'Ann', email: 'ann@example.com' } }))).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('admin', () => {
  it('is for admins only', async () => {
    await expect((adminGet as Handler)(ev({ userId: editorId, query: { view: 'status' } }))).rejects.toMatchObject({ statusCode: 403 })
    await expect((adminPost as Handler)(ev({ userId: editorId, body: { action: 'sync' } }))).rejects.toMatchObject({ statusCode: 403 })
    const status = await (adminGet as Handler)(ev({ userId: adminId, query: { view: 'status' } })) as { planIncluded: boolean; index: { indexAvailable: boolean } }
    expect(status).toMatchObject({ planIncluded: true, aiAvailable: true, index: { indexAvailable: true } })
  })

  it('checks the settings, and lists transcripts with the details left', async () => {
    expect(() => normalizeChatbotSetting({ ...DEFAULT_CHATBOT_SETTINGS, name: '' })).toThrow()
    const list = await (adminGet as Handler)(ev({ userId: adminId, query: { view: 'conversations', leads: '1' } })) as { conversations: { leadName: string | null; firstMessage: string }[] }
    expect(list.conversations[0]).toMatchObject({ leadName: 'Ann Lee', firstMessage: 'Can you cater a wedding?' })
  })
})

describe('hosting plans', () => {
  it('needs a plan that includes the chatbot', async () => {
    await seedSetting(db(), PRIMARY, 'platform.hosting_enabled', true)
    clearHostingPlatformCache()
    const planId = ulid()
    await db().insert(hostingPlans).values({ id: planId, name: 'Basic' })
    await db().update(sites).set({ hostingPlanId: planId }).where(eq(sites.id, SITE))
    clearHostingPlanCache()

    await expect((chatRoute as Handler)(ev({ body: { action: 'message', token: TOKEN, message: 'Hi' } }))).rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_feature' } })
    expect(await sitesNeedingChatIndex(ev(), db())).toEqual([])
    // Switching it on is refused (it's already on here, so first switch it off).
    await setChatbot({ enabled: false })
    await expect((patchSettings as Handler)(ev({ userId: adminId, body: { settings: { [CHATBOT_SETTING_KEY]: { ...DEFAULT_CHATBOT_SETTINGS, enabled: true } } } })))
      .rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_feature', feature: 'chatbot' } })

    await db().update(hostingPlans).set({ allowChatbot: true }).where(eq(hostingPlans.id, planId))
    clearHostingPlanCache()
    await (patchSettings as Handler)(ev({ userId: adminId, body: { settings: { [CHATBOT_SETTING_KEY]: { ...DEFAULT_CHATBOT_SETTINGS, enabled: true } } } }))
    expect((await getChatbotSettings(ev())).enabled).toBe(true)

    await db().update(sites).set({ hostingPlanId: null }).where(eq(sites.id, SITE))
    await db().delete(siteSettings).where(and(eq(siteSettings.siteId, PRIMARY), eq(siteSettings.key, 'platform.hosting_enabled')))
    clearHostingPlatformCache()
    clearHostingPlanCache()
  })
})

describe('clean-up', () => {
  it('deletes conversations after 30 days, and every vector with the site', async () => {
    const old = ulid()
    await db().insert(chatConversations).values({ id: old, siteId: SITE, visitorTokenHash: 'x', lastMessageAt: '2020-01-01 00:00:00' })
    await db().insert(chatMessages).values({ id: ulid(), siteId: SITE, conversationId: old, role: 'user', text: 'old' })
    await pruneOldData()
    expect(await db().query.chatConversations.findFirst({ where: eq(chatConversations.id, old) })).toBeUndefined()
    expect(await db().select().from(chatMessages).where(eq(chatMessages.conversationId, old))).toEqual([])

    const ids = (await db().select({ id: chatChunks.id }).from(chatChunks).where(eq(chatChunks.siteId, SITE))).map(r => r.id)
    expect(ids.length).toBeGreaterThan(0)
    await deleteChatVectors(ev(), db(), SITE)
    for (const id of ids) expect(vectors.has(id)).toBe(false)
    // Knowledge rows are untouched by that (they go with the site's FK cascade).
    expect((await db().select().from(chatKnowledge).where(eq(chatKnowledge.siteId, SITE))).length).toBe(1)
  })
})
