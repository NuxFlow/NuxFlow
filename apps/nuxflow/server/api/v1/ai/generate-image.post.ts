import { z } from 'zod'
import { requireRole } from '../../../utils/permissions'
import { getImageProvider } from '../../../utils/image-providers/index'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

const bodySchema = z.object({
  prompt: z.string().min(5).max(1000),
  size: z.enum(['1024x1024', '1792x1024', '1024x1792']).optional().default('1024x1024'),
  quality: z.enum(['standard', 'hd']).optional().default('standard'),
  saveToLibrary: z.boolean().optional().default(true),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'ai-image' })

  const imageProvider = await getImageProvider(event)
  if (!imageProvider) {
    throw createError({ statusCode: 503, message: 'No image generation provider available. Configure an OpenAI or Google Gemini key.' })
  }

  const { prompt, size, quality, saveToLibrary } = await readValidatedBody(event, bodySchema.parse)
  const siteId = event.context.siteId as string

  let imageUrl: string
  try {
    imageUrl = await imageProvider.generate(prompt, { size, quality })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image generation failed'
    throw createError({ statusCode: 502, message: msg })
  }

  if (!saveToLibrary) {
    return { url: imageUrl, saved: false }
  }

  // Fetch the image bytes and save to the media library
  let finalUrl = imageUrl
  let mediaId: string | undefined

  try {
    const isDataUrl = imageUrl.startsWith('data:')
    let imageBlob: Blob

    if (isDataUrl) {
      // Imagen returns a base64 data URL
      const commaIdx = imageUrl.indexOf(',')
      const header = commaIdx > -1 ? imageUrl.slice(0, commaIdx) : ''
      const b64 = commaIdx > -1 ? imageUrl.slice(commaIdx + 1) : ''
      const mime = header.replace('data:', '').replace(';base64', '')
      const bytes = Uint8Array.from(atob(b64 as string), c => c.charCodeAt(0))
      imageBlob = new Blob([bytes], { type: mime })
    } else {
      // DALL-E returns a temporary HTTPS URL — fetch it
      const imgRes = await fetch(imageUrl)
      imageBlob = await imgRes.blob()
    }

    const ext = imageBlob.type.includes('png') ? 'png' : 'jpg'
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
  } catch {
    // If saving fails, return the temporary URL so the user isn't left with nothing
    return { url: imageUrl, saved: false, error: 'Generated but could not save to media library' }
  }

  return { url: finalUrl, mediaId, saved: true }
})
