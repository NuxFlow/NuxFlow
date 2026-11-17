import { z } from 'zod'
import { useDb } from '../../utils/db'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { writeAuditLog } from '../../utils/audit'
import { saveSetting } from '../../utils/settings'
import { forbidden } from '../../utils/response'
import { chatbotIncluded, getChatbotSettings } from '../../utils/chatbot'
import { CHATBOT_INDEX_STAMP_KEY, chatIndexStatus, currentChatIndexStamp, syncSiteChatIndex } from '../../utils/chatbot-index'
import { deleteConversation, deleteKnowledge, KNOWLEDGE_BODY_MAX, KNOWLEDGE_TITLE_MAX, saveKnowledge } from '../../utils/chatbot-admin'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('knowledge-save'),
    id: z.string().max(40).optional(),
    kind: z.enum(['faq', 'text']),
    title: z.string().trim().min(1, 'Add a question or title').max(KNOWLEDGE_TITLE_MAX),
    body: z.string().trim().min(1, 'Add the answer or text').max(KNOWLEDGE_BODY_MAX),
    enabled: z.boolean().default(true),
  }),
  z.object({ action: z.literal('knowledge-delete'), id: z.string().max(40) }),
  z.object({ action: z.literal('conversation-delete'), id: z.string().max(40) }),
  // "Update now": learn changed pages straight away instead of waiting for the task.
  z.object({ action: z.literal('sync') }),
])

/** Chunks "Update now" embeds per click; the every-minute task does the rest. */
const SYNC_BUDGET = 120

// Admin → Chatbot. Not under /api (TS2589), so the CSRF middleware doesn't see it and
// requests from another site are refused here. Settings are saved through the settings
// PATCH (chatbot.settings), like Business and Podcast.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') forbidden('Only from this site')
  const { userId } = await requireRole(event, 'admin')
  const body = await parseBody(event, bodySchema)
  const db = useDb(event)

  switch (body.action) {
    case 'knowledge-save': {
      const { id, created } = await saveKnowledge(db, siteId, body)
      await writeAuditLog(event, userId, { action: created ? 'create' : 'update', resource: 'chat_knowledge', resourceId: id })
      return { id }
    }
    case 'knowledge-delete':
      await deleteKnowledge(db, siteId, body.id)
      await writeAuditLog(event, userId, { action: 'delete', resource: 'chat_knowledge', resourceId: body.id })
      return { success: true }
    case 'conversation-delete':
      await deleteConversation(db, siteId, body.id)
      await writeAuditLog(event, userId, { action: 'delete', resource: 'chat_conversation', resourceId: body.id })
      return { success: true }
    case 'sync': {
      if (!(await chatbotIncluded(db, siteId))) forbidden('Your hosting plan doesn\'t include the chatbot', { code: 'plan_feature', feature: 'chatbot' })
      const settings = await getChatbotSettings(event)
      const stamp = await currentChatIndexStamp(event, db, siteId, settings)
      const result = await syncSiteChatIndex(event, db, siteId, settings, SYNC_BUDGET)
      if (result.done && stamp && settings.enabled) await saveSetting(event, CHATBOT_INDEX_STAMP_KEY, stamp)
      return { ...result, index: await chatIndexStatus(event, db, siteId, settings) }
    }
  }
})
