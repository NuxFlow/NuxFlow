import { z } from 'zod'
import { generateText } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow, loadImageBytesForAi } from '../../../utils/ai-sdk'
import { useDb } from '../../../utils/db'
import { getMediaByIdOrThrow } from '../../../utils/resource-queries'

const bodySchema = z.object({ mediaId: z.string() })

const SYSTEM = `You are an accessibility expert. Write concise, descriptive alt text for an image. Return ONLY the alt text string, no quotes, no explanation.`

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const model = await requireAiSdkModel(event, 'fast')

  const { mediaId } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const file = await getMediaByIdOrThrow(db, siteId, mediaId, 'Media not found', { originalName: true, url: true, mimeType: true })

  // The model needs to actually see the image — a prompt built only from the filename
  // (e.g. "IMG_2384.jpg") gives it nothing to describe and produces plausible-sounding but
  // fabricated alt text, which is worse for accessibility than no alt text at all.
  const { data, mediaType } = await callAiOrThrow(() => loadImageBytesForAi(file.url, file.mimeType))

  const { text } = await callAiOrThrow(() =>
    generateText({
      model,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Generate alt text for this image (filename: "${file.originalName}").` },
          { type: 'image', image: data, mediaType },
        ],
      }],
      maxOutputTokens: 100,
    }),
  )
  return { altText: text.trim() }
})
