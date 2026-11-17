import { z } from 'zod'
import { streamText } from 'ai'
import { ulid } from 'ulid'
import { useDb } from '../../utils/db'
import { requireSiteId } from '../../utils/site-context'
import { rateLimit } from '../../utils/rate-limit'
import { requireRole } from '../../utils/permissions'
import { requireAiSdkModel } from '../../utils/ai-sdk'
import { getSiteInfo } from '../../utils/site-info'
import { resolveStringSetting } from '../../utils/settings'
import { getTurnstileSecret, verifyTurnstile } from '../../utils/turnstile'
import { getClientIp } from '../../utils/client-ip'
import { isDemoMode } from '../../utils/demo-mode'
import { forbidden, httpError, notFound, validationError } from '../../utils/response'
import {
  chatbotIncluded, conversationHistory, findOwnConversation, findPassages, getChatbotSettings, isChatToken, openConversation,
  passageSources, rateChatAnswer, recordChatLead, saveChatMessage, siteBusinessFacts, siteLanguageName, siteNow, storedReply,
} from '../../utils/chatbot'
import { buildChatSystemPrompt } from '../../utils/chatbot-prompt'
import { chatLiveFacts } from '../../utils/chatbot-live'
import { CHATBOT_LIMITS } from '../../../shared/lib/chatbot'

const token = z.string().max(128)
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('message'),
    token,
    conversationId: z.string().max(40).optional(),
    message: z.string().trim().min(1).max(CHATBOT_LIMITS.message, 'That message is too long'),
    path: z.string().max(500).default('/'),
    turnstileToken: z.string().max(4096).optional(),
    // Admin → Chatbot → Try it: works before the bubble is switched on, kept out of transcripts.
    test: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('lead'),
    token,
    conversationId: z.string().max(40).optional(),
    name: z.string().trim().min(1, 'Please add your name').max(100),
    email: z.string().trim().toLowerCase().email('That email doesn\'t look right').max(254),
    phone: z.string().trim().max(40).optional(),
    message: z.string().trim().max(2000).optional(),
    path: z.string().max(500).default('/'),
    turnstileToken: z.string().max(4096).optional(),
    // Honeypot: a real visitor never fills it in.
    website: z.string().max(200).optional(),
  }),
  // Thumbs up (1) or down (-1) on one of the bot's answers; 0 takes it back.
  z.object({
    action: z.literal('rate'),
    token,
    conversationId: z.string().max(40),
    messageId: z.string().max(40),
    rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  }),
])

/** Most of the model's reply, in tokens — a chat answer is short. */
const MAX_REPLY_TOKENS = 700

/**
 * The website chatbot, for visitors (server/utils/chatbot.ts). Not under /api — one more
 * typed API address trips TS2589 — so the CSRF middleware doesn't cover it and requests from
 * other sites are refused here, as gallery picks do. `message` streams the reply as plain
 * text; the conversation id and the source links come back in headers.
 */
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') forbidden('The chat can only be used on this site')
  if (isDemoMode(event)) forbidden('The chat is turned off in the demo')

  const body = await parseBody(event, bodySchema)
  const db = useDb(event)
  const isTest = body.action === 'message' && body.test === true
  if (isTest) await requireRole(event, 'admin')

  const settings = await getChatbotSettings(event)
  if (!settings.enabled && !isTest) notFound('The chat isn\'t switched on')
  if (!(await chatbotIncluded(db, siteId))) forbidden('Your hosting plan doesn\'t include the chatbot', { code: 'plan_feature', feature: 'chatbot' })
  if (!isChatToken(body.token)) validationError('Invalid token')

  if (body.action === 'rate') {
    await rateLimit(event, { limit: 60, windowMs: 60_000, keyPrefix: 'chat-rate' })
    const conversation = await findOwnConversation(db, siteId, body.token, body.conversationId)
    if (!conversation || !(await rateChatAnswer(db, siteId, conversation, body.messageId, body.rating))) notFound('That answer no longer exists')
    return { ok: true }
  }

  if (body.action === 'lead') {
    await rateLimit(event, { limit: 5, windowMs: 10 * 60_000, keyPrefix: 'chat-lead' })
    if (settings.lead.mode === 'off') forbidden('This chat doesn\'t take messages')
    if (body.website) return { ok: true }
    const conversation = await openConversation(db, siteId, { token: body.token, conversationId: body.conversationId, path: body.path, isTest: false })
    // A lead from a conversation that hasn't been checked yet (the "Leave a message" button
    // before any chat) goes through the spam check here instead.
    if (conversation.messageCount === 0) await checkTurnstile(event, body.turnstileToken)
    await recordChatLead(event, siteId, conversation, { name: body.name, email: body.email, phone: settings.lead.askPhone ? body.phone : undefined, message: body.message })
    return { ok: true, conversationId: conversation.id }
  }

  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'chat-message' })
  const conversation = await openConversation(db, siteId, { token: body.token, conversationId: body.conversationId, path: body.path, isTest })
  if (conversation.messageCount === 0 && !isTest) await checkTurnstile(event, body.turnstileToken)
  if (conversation.messageCount >= settings.maxMessages) {
    httpError({ status: 429, message: 'This conversation has reached its limit. Start a new one, or leave your details and the team will get back to you.', data: { code: 'chat_limit', conversationId: conversation.id } })
  }

  // Up front, so a used-up allowance is a clear 403 (the bubble offers to take a message).
  const model = await requireAiSdkModel(event, 'fast', { trigger: 'chat' })
  const site = await getSiteInfo(event, siteId)
  const siteTimes = { name: site?.name ?? '', timezone: site?.timezone ?? 'UTC', locale: site?.locale ?? 'en' }
  const [history, passages, facts] = await Promise.all([
    conversationHistory(db, siteId, conversation.id),
    findPassages(event, siteId, body.message),
    siteBusinessFacts(event, siteTimes),
  ])
  // Prices, stock, free times and events read now — for the pages just found.
  const liveFacts = await chatLiveFacts(event, db, siteId, siteTimes, settings, passages)
  const system = buildChatSystemPrompt({
    siteName: site?.name ?? 'this website',
    siteLanguage: siteLanguageName(site?.locale ?? 'en'),
    settings,
    businessFacts: facts,
    liveFacts,
    passages,
    now: siteNow(site?.timezone ?? 'UTC'),
  })
  const sources = settings.showSources ? passageSources(passages) : []
  await saveChatMessage(db, siteId, conversation.id, 'user', body.message)

  const result = streamText({
    model,
    system,
    messages: [...history, { role: 'user' as const, content: body.message }],
    maxOutputTokens: MAX_REPLY_TOKENS,
    maxRetries: 1,
    onError: ({ error }) => console.error('[chat] Answer failed:', error),
  })

  // Made now so the bubble can rate this answer (header below).
  const answerId = ulid()
  let reply = ''
  const encoder = new TextEncoder()
  const stream = (result.textStream as ReadableStream<string>).pipeThrough(new TransformStream<string, Uint8Array>({
    transform(part, controller) {
      reply += part
      controller.enqueue(encoder.encode(part))
    },
    async flush() {
      // Saved once the whole reply is out (the response stays open until this finishes).
      const { text, wantsLead } = storedReply(reply)
      if (text.trim()) {
        await saveChatMessage(db, siteId, conversation.id, 'assistant', text, { id: answerId, sources: sources.length ? sources : null, unanswered: wantsLead })
          .catch(err => console.error('[chat] Saving the reply failed:', err))
      }
    },
  }))

  setResponseHeaders(event, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-chat-conversation': conversation.id,
    'x-chat-message': answerId,
    'x-chat-sources': encodeURIComponent(JSON.stringify(sources)),
  })
  return sendStream(event, stream)
})

/** Turnstile on a conversation's first message (or a first-thing lead), when the site uses it. */
async function checkTurnstile(event: Parameters<typeof getClientIp>[0], tokenValue: string | undefined): Promise<void> {
  if (!getTurnstileSecret()) return
  if (!(await resolveStringSetting(event, 'integrations.turnstile_site_key'))) return
  if (!(await verifyTurnstile(tokenValue ?? '', getClientIp(event) ?? undefined))) validationError('Spam check failed. Please try again.', { code: 'turnstile' })
}
