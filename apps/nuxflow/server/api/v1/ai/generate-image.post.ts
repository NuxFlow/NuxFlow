import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { getImageProvider } from '../../../utils/image-providers/index'
import { callAiOrThrow } from '../../../utils/ai-sdk'
import { AI_CREDITS, assertAiAllowance, recordAiCall } from '../../../utils/ai-allowance'
import { assertWithinPlan } from '../../../utils/hosting-plans'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { base64ToBytes } from '../../../../shared/lib/base64'
import { requireSiteId } from '../../../utils/site-context'

const bodySchema = z.object({
  prompt: z.string().min(5).max(1000),
  shape: z.enum(['square', 'landscape', 'portrait']).optional().default('square'),
  quality: z.enum(['standard', 'hd']).optional().default('standard'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'ai-image' })

  const imageProvider = await getImageProvider(event, { userId })
  if (!imageProvider) {
    throw httpError({ status: 503, message: 'No image generation provider available. Add an OpenAI or Google Gemini key in Settings → AI, or enable the Workers AI binding.' })
  }

  const { prompt, shape, quality } = await parseBody(event, bodySchema)
  const siteId = requireSiteId(event)

  // Every generated image is saved to the library (providers return a data: URL, which
  // must never end up in content or the database). Both checks run before generating, so
  // a site with no file storage or a full library doesn't spend an AI call on an image
  // it can't keep.
  const storageProvider = await getActiveProvider(event)
  await assertWithinPlan(event, 'storage')
  // Only images the platform pays for are limited; the site's own key is never refused.
  if (imageProvider.payer === 'platform') await assertAiAllowance(event, AI_CREDITS.image)
  recordAiCall(event, imageProvider.payer, AI_CREDITS.image)
  const imageUrl = await callAiOrThrow(() => imageProvider.generate(prompt, { shape, quality }))

  // Every provider returns a data: URL (image-providers/index.ts).
  const commaIdx = imageUrl.indexOf(',')
  const mime = imageUrl.slice(5, commaIdx).replace(';base64', '') || 'image/png'
  const bytes = base64ToBytes(imageUrl.slice(commaIdx + 1))
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  const filename = `ai-${ulid()}.${ext}`
  const file = new File([bytes], filename, { type: mime })
  const storageKey = `${siteId}/${ulid()}.${ext}`

  let storedUrl: string
  try {
    ;({ url: storedUrl } = await storageProvider.upload(file, storageKey, siteId))
  } catch (err) {
    console.error('[generate-image] Failed to save generated image to media library:', err)
    throw httpError({ status: 502, message: "The image was generated but couldn't be saved to the media library. Please try again." })
  }

  const mediaId = ulid()
  await useDb(event).insert(media).values({
    id: mediaId,
    siteId,
    uploadedBy: userId,
    filename: storageKey,
    originalName: filename,
    mimeType: mime,
    size: file.size,
    url: storedUrl,
    altText: prompt.slice(0, 200),
    storageProvider: storageProvider.name as 'cloudflare' | 'r2',
    storageKey,
  })

  return { url: storedUrl, mediaId, saved: true }
})
