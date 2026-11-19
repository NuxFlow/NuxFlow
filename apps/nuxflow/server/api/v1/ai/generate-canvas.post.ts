import { z } from 'zod'
import type { CanvasBlockData } from '@nuxflow/canvas'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { canvasEditBodySchema, canvasGenerationBodySchema, editCanvasPage, generateCanvasPage, loadGenerationContext } from '../../../utils/canvas-generation'
import { requireSiteId } from '../../../utils/site-context'

// The canvas editor's AI modal: "New page" (a description → a whole page) or "Change this
// page" (an instruction + the page as it is in the editor → edits to it). Both return
// content only — the editor shows it in place as a preview the person keeps or discards
// (CanvasContentEditor.vue), so nothing is saved here. One route for both, rather than a
// second address: one more typed /api route tips `nuxt typecheck` into TS2589.
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-canvas' })

  const model = await requireAiSdkModel(event, 'smart', { userId })

  const body = await parseBody(event, z.union([canvasEditBodySchema, canvasGenerationBodySchema]))
  const ctx = await loadGenerationContext(event, useDb(event), requireSiteId(event))

  if ('instruction' in body) {
    const edit = await editCanvasPage(model, ctx, body.content.blocks as CanvasBlockData[], body.instruction)
    return edit
  }
  const { description, tone, pageGoal } = body

  const page = await generateCanvasPage(model, ctx, { description, tone, pageGoal })
  return page.content
})
