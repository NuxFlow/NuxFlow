import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { canvasGenerationBodySchema, generateCanvasBlocks } from '../../../utils/canvas-generation'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-canvas' })

  const model = await requireAiSdkModel(event, 'smart', { userId })

  const { description, tone, pageGoal } = await parseBody(event, canvasGenerationBodySchema)

  return generateCanvasBlocks(model, description, tone, pageGoal)
})
