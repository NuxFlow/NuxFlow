import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { canvasGenerationBodySchema, generateCanvasPage, loadGenerationContext } from '../../../utils/canvas-generation'

// The canvas editor's "Generate page" modal. Returns the content only — the editor applies
// it in place as an undoable preview the editor can keep or discard (see
// CanvasContentEditor.vue), so nothing is saved here.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-canvas' })

  const model = await requireAiSdkModel(event, 'smart', { userId })

  const { description, tone, pageGoal } = await parseBody(event, canvasGenerationBodySchema)
  const ctx = await loadGenerationContext(event, useDb(event), event.context.siteId as string)

  const page = await generateCanvasPage(model, ctx, { description, tone, pageGoal })
  return page.content
})
