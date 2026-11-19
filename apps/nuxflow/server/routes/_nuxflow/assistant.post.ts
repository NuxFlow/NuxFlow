import { z } from 'zod'
import { useDb } from '../../utils/db'
import { requireSiteId } from '../../utils/site-context'
import { requireAuth } from '../../utils/permissions'
import { rateLimit } from '../../utils/rate-limit'
import { requireAiSdkModel } from '../../utils/ai-sdk'
import { isDemoMode } from '../../utils/demo-mode'
import { isCrossOriginUnsafeRequest } from '../../utils/csrf'
import { forbidden } from '../../utils/response'
import { askAssistant, loadAssistantContext } from '../../utils/assistant'
import { ASSISTANT_LIMITS, type AssistantResponse } from '../../../shared/lib/assistant'

/**
 * The admin AI helper ("Ask AI", AdminAssistantPanel; server/utils/assistant.ts). Answers
 * questions and returns proposals the person applies themselves — this route changes
 * nothing. Not under /api (one more typed API address trips TS2589), so the CSRF
 * middleware doesn't cover it and cross-site requests are refused here. Conversations
 * aren't stored: the panel sends the recent messages with each question.
 */
const bodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(ASSISTANT_LIMITS.messageChars * 3),
  })).min(1).max(ASSISTANT_LIMITS.messages)
    .refine(m => m.at(-1)?.role === 'user', { message: 'The last message must be the question' }),
  // The admin screens this person can open (the sidebar, filtered by role on the client —
  // only used to suggest links, and every link is checked against this same list).
  sections: z.array(z.object({
    label: z.string().max(80),
    to: z.string().max(200).startsWith('/admin'),
  })).max(ASSISTANT_LIMITS.sections).default([]),
})

export default defineEventHandler(async (event): Promise<AssistantResponse> => {
  if (isCrossOriginUnsafeRequest(event)) forbidden('The helper can only be used on this site')
  if (isDemoMode(event)) forbidden('The AI helper is turned off in the demo')
  const siteId = requireSiteId(event)
  const { userId, role } = await requireAuth(event)
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'ai-assistant' })
  const model = await requireAiSdkModel(event, 'smart', { userId })

  const body = await parseBody(event, bodySchema)
  const messages = body.messages.map(m => ({ role: m.role, text: m.role === 'user' ? m.text.slice(0, ASSISTANT_LIMITS.messageChars) : m.text }))
  const question = messages.at(-1)!.text
  const ctx = await loadAssistantContext(event, useDb(event), { siteId, userId, role, sections: body.sections, question })
  return askAssistant(model, ctx, messages)
})
