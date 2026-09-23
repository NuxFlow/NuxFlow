import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow, loadImageBytesForAi } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { getMediaByIdOrThrow } from '../../../utils/resource-queries'

const bodySchema = z.object({ mediaId: z.string() })

const focalPointSchema = z.object({
  x: z.number().min(0).max(1).describe('Horizontal focal point: 0 = left edge, 1 = right edge, 0.5 = center'),
  y: z.number().min(0).max(1).describe('Vertical focal point: 0 = top edge, 1 = bottom edge, 0.5 = center'),
  reasoning: z.string().max(200),
})

const SYSTEM = `You identify the main subject of an image for smart image cropping. Given an image, return the normalized (x, y) coordinate of the single most important point to keep visible when the image gets cropped to a different aspect ratio — typically a face, a product, or whatever the clear focal subject is. (0,0) is the image's top-left corner, (1,1) is its bottom-right corner, (0.5,0.5) is dead center.`

/**
 * AI-suggested focal point for CanvasBlockImage's manual focal-point sliders (see
 * packages/canvas/src/blocks/CanvasBlockImage.vue's `fit === 'cover'` condition) — a vision
 * model call, backend-only for now (no "AI suggest" button wired into the canvas field
 * editor yet — that's a cross-package UI change in @nuxflow/canvas, a separate follow-up).
 * Returns coordinates ready to feed directly into that block's existing focalX/focalY props.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-focal-point' })
  const model = await requireAiSdkModel(event, 'vision', { userId })

  const { mediaId } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const file = await getMediaByIdOrThrow(db, siteId, mediaId, 'Media not found', { url: true, mimeType: true })
  if (!file.mimeType.startsWith('image/')) {
    throw createError({ statusCode: 422, message: 'Focal point suggestion only applies to images' })
  }

  const { data, mediaType } = await callAiOrThrow(() => loadImageBytesForAi(file.url, file.mimeType))

  const { object } = await callAiOrThrow(() =>
    generateObject({
      model,
      schema: focalPointSchema,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Where is the main subject of this image?' },
          { type: 'image', image: data, mediaType },
        ],
      }],
      maxOutputTokens: 200,
    }),
  )

  return object
})
