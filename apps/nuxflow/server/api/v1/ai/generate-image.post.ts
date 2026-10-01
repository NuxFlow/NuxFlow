import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { getImageProvider } from '../../../utils/image-providers/index'
import { callAiOrThrow } from '../../../utils/ai-sdk'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  prompt: z.string().min(5).max(1000),
  shape: z.enum(['square', 'landscape', 'portrait']).optional(),
  // Older clients sent DALL-E 3's pixel sizes; mapped onto a shape.
  size: z.enum(['1024x1024', '1792x1024', '1024x1792']).optional(),
  quality: z.enum(['standard', 'hd']).optional().default('standard'),
  saveToLibrary: z.boolean().optional().default(true),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'ai-image' })

  const imageProvider = await getImageProvider(event, { userId })
  if (!imageProvider) {
    throw createError({ statusCode: 503, message: 'No image generation provider available. Add an OpenAI or Google Gemini key in Settings → AI, or enable the Workers AI binding.' })
  }

  const { prompt, shape: requestedShape, size, quality, saveToLibrary } = await parseBody(event, bodySchema)
  const shape = requestedShape ?? (size === '1792x1024' ? 'landscape' : size === '1024x1792' ? 'portrait' : 'square')
  const siteId = event.context.siteId as string

  const imageUrl = await callAiOrThrow(() => imageProvider.generate(prompt, { shape, quality }))

  if (!saveToLibrary) {
    return { url: imageUrl, saved: false }
  }

  // Fetch the image bytes and save to the media library
  let finalUrl: string
  let mediaId: string | undefined

  try {
    // Every provider returns a data: URL (image-providers/index.ts).
    const commaIdx = imageUrl.indexOf(',')
    const mime = imageUrl.slice(5, commaIdx).replace(';base64', '') || 'image/png'
    const bytes = Uint8Array.from(atob(imageUrl.slice(commaIdx + 1)), c => c.charCodeAt(0))
    const imageBlob = new Blob([bytes], { type: mime })

    const ext = imageBlob.type.includes('png') ? 'png' : imageBlob.type.includes('webp') ? 'webp' : 'jpg'
    const filename = `ai-${ulid()}.${ext}`
    const file = new File([imageBlob], filename, { type: imageBlob.type })

    const storageProvider = await getActiveProvider(event)
    const storageKey = `${siteId}/${ulid()}.${ext}`
    const { url: storedUrl } = await storageProvider.upload(file, storageKey, siteId)

    const db = useDb(event)
    mediaId = ulid()
    await db.insert(media).values({
      id: mediaId,
      siteId,
      uploadedBy: userId,
      filename: storageKey,
      originalName: filename,
      mimeType: imageBlob.type,
      size: imageBlob.size,
      url: storedUrl,
      altText: prompt.slice(0, 200),
      storageProvider: storageProvider.name as 'cloudflare' | 'local' | 'r2',
      storageKey,
    })
    finalUrl = storedUrl
  } catch (err) {
    // If saving fails, return the temporary URL so the user isn't left with nothing —
    // but still log the real cause, otherwise a persistently misconfigured storage
    // provider has no diagnosable trail beyond this generic message.
    console.error('[generate-image] Failed to save generated image to media library:', err)
    return { url: imageUrl, saved: false, error: 'Generated but could not save to media library' }
  }

  return { url: finalUrl, mediaId, saved: true }
})
