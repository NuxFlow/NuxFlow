import { z } from 'zod'
import { useDb } from '../../utils/db'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { getAiSdkModel } from '../../utils/ai-sdk'
import { resolveStringSetting } from '../../utils/settings'
import { getTurnstileSecret } from '../../utils/turnstile'
import { chatbotIncluded, getChatbotSettings } from '../../utils/chatbot'
import { chatIndexStatus } from '../../utils/chatbot-index'
import { getTranscript, listConversations, listKnowledge } from '../../utils/chatbot-admin'
import type { ChatbotStatusResponse } from '../../../shared/lib/chatbot'

// Admin → Chatbot. Not under /api: one more typed API address trips TS2589.
//   ?view=status                      → settings, plan, AI and index state
//   ?view=knowledge                   → FAQ and free-text entries
//   ?view=conversations[&leads=1]     → recent transcripts
//   ?view=conversation&id=            → one transcript
const querySchema = z.object({
  view: z.enum(['status', 'knowledge', 'conversations', 'conversation']).default('status'),
  id: z.string().max(40).optional(),
  leads: z.enum(['0', '1']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})

const PAGE_SIZE = 30

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const siteId = requireSiteId(event)
  const db = useDb(event)
  const q = parseQuery(event, querySchema)
  setHeader(event, 'Cache-Control', 'private, no-store')

  switch (q.view) {
    case 'knowledge':
      return { entries: await listKnowledge(db, siteId) }
    case 'conversations':
      return { ...await listConversations(db, siteId, { leadsOnly: q.leads === '1', limit: PAGE_SIZE, offset: (q.page - 1) * PAGE_SIZE }), page: q.page, pageSize: PAGE_SIZE }
    case 'conversation':
      return getTranscript(db, siteId, q.id ?? '')
    default: {
      const settings = await getChatbotSettings(event)
      const [planIncluded, model, index, siteKey] = await Promise.all([
        chatbotIncluded(db, siteId),
        getAiSdkModel(event, 'fast', { trigger: 'chat' }),
        chatIndexStatus(event, db, siteId, settings),
        resolveStringSetting(event, 'integrations.turnstile_site_key'),
      ])
      return { settings, planIncluded, aiAvailable: !!model, index, turnstile: !!siteKey && !!getTurnstileSecret() } satisfies ChatbotStatusResponse
    }
  }
})
