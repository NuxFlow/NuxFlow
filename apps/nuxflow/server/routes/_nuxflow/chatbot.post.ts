import { z } from 'zod'
import { useDb } from '../../utils/db'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { writeAuditLog } from '../../utils/audit'
import { saveSetting } from '../../utils/settings'
import { forbidden, validationError } from '../../utils/response'
import { isDemoMode } from '../../utils/demo-mode'
import { chatbotIncluded, getChatbotSettings } from '../../utils/chatbot'
import { CHATBOT_INDEX_STAMP_KEY, chatIndexStatus, currentChatIndexStamp, syncSiteChatIndex } from '../../utils/chatbot-index'
import { chatDocumentText, deleteConversation, deleteKnowledge, documentTitle, KNOWLEDGE_BODY_MAX, KNOWLEDGE_TITLE_MAX, reviewChatAnswer, saveKnowledge } from '../../utils/chatbot-admin'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('knowledge-save'),
    id: z.string().max(40).optional(),
    kind: z.enum(['faq', 'text', 'document']),
    title: z.string().trim().min(1, 'Add a question or title').max(KNOWLEDGE_TITLE_MAX),
    body: z.string().trim().min(1, 'Add the answer or text').max(KNOWLEDGE_BODY_MAX),
    enabled: z.boolean().default(true),
  }),
  z.object({ action: z.literal('knowledge-delete'), id: z.string().max(40) }),
  z.object({ action: z.literal('conversation-delete'), id: z.string().max(40) }),
  // Insights: an answer was added for this one, or it isn't worth one.
  z.object({ action: z.literal('review'), messageId: z.string().max(40) }),
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
  const db = useDb(event)

  // A document to learn from: multipart `file` (and an optional `title`). Only its text is kept.
  if (getHeader(event, 'content-type')?.startsWith('multipart/form-data')) {
    if (isDemoMode(event)) forbidden('Uploading documents is turned off in the demo')
    const parts = await readMultipartFormData(event) ?? []
    const file = parts.find(p => p.name === 'file' && p.filename)
    if (!file) validationError('Choose a file to upload.')
    const title = parts.find(p => p.name === 'title')?.data.toString().trim().slice(0, KNOWLEDGE_TITLE_MAX)
    const { text, truncated } = await chatDocumentText(event, { name: file.filename!, type: file.type ?? '', data: new Uint8Array(file.data) })
    const { id } = await saveKnowledge(db, siteId, {
      kind: 'document',
      title: title || documentTitle(file.filename!),
      body: text,
      enabled: true,
      fileName: file.filename!.slice(0, 255),
      fileSize: file.data.byteLength,
    })
    await writeAuditLog(event, userId, { action: 'create', resource: 'chat_knowledge', resourceId: id, after: { kind: 'document', fileName: file.filename } })
    return { id, characters: text.length, truncated }
  }

  const body = await parseBody(event, bodySchema)

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
    case 'review':
      await reviewChatAnswer(db, siteId, body.messageId)
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
