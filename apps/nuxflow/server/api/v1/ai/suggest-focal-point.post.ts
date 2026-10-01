import { z } from 'zod'
import { generateObject } from 'ai'
import { and, eq } from 'drizzle-orm'
import { media } from '@nuxflow/db/schema'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow, loadImageBytesForAi } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { getMediaByIdOrThrow } from '../../../utils/resource-queries'

// Either the media item's id, or the image URL a canvas block stores (the image field
// keeps `{ url, width, height }`, not the library id). A URL only resolves to an item in
// this site's own library — never fetched as an arbitrary address.
const bodySchema = z.object({
  mediaId: z.string().optional(),
  url: z.string().max(2048).optional(),
}).refine(b => b.mediaId || b.url, { message: 'mediaId or url is required' })

const focalPointSchema = z.object({
  x: z.number().min(0).max(1).describe('Horizontal focal point: 0 = left edge, 1 = right edge, 0.5 = center'),
  y: z.number().min(0).max(1).describe('Vertical focal point: 0 = top edge, 1 = bottom edge, 0.5 = center'),
  reasoning: z.string().max(200),
})

const SYSTEM = `You identify the main subject of an image for smart image cropping. Given an image, return the normalized (x, y) coordinate of the single most important point to keep visible when the image gets cropped to a different aspect ratio — typically a face, a product, or whatever the clear focal subject is. (0,0) is the image's top-left corner, (1,1) is its bottom-right corner, (0.5,0.5) is dead center.`

/**
 * AI-suggested focal point for CanvasBlockImage's focal-point sliders — the "Suggest with
 * AI" button in the canvas editor's field panel. `focalX`/`focalY` are percentages, ready
 * to drop straight into that block's props.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-focal-point' })
  const model = await requireAiSdkModel(event, 'vision', { userId })

  const { mediaId, url } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const file = mediaId
    ? await getMediaByIdOrThrow(db, siteId, mediaId, 'Media not found', { url: true, mimeType: true })
    : await db.query.media.findFirst({
        where: and(eq(media.siteId, siteId), eq(media.url, url!)),
        columns: { url: true, mimeType: true },
      })
  if (!file) throw notFound('This image isn\'t in the media library — focal points can only be suggested for library images')
  if (!file.mimeType.startsWith('image/')) {
    throw createError({ statusCode: 422, message: 'Focal point suggestion only applies to images' })
  }

  const { data, mediaType } = await callAiOrThrow(() => loadImageBytesForAi(event, file.url, file.mimeType))

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

  return { ...object, focalX: Math.round(object.x * 100), focalY: Math.round(object.y * 100) }
})
