import { z } from 'zod'
import { generateText } from 'ai'
import { requireAuth } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { useDb } from '../../../utils/db'
import { getMediaByIdOrThrow } from '../../../utils/resource-queries'

const bodySchema = z.object({ mediaId: z.string() })

const SYSTEM = `You are an accessibility expert. Write concise, descriptive alt text for an image. Return ONLY the alt text string, no quotes, no explanation.`

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const model = await requireAiSdkModel(event, 'fast')

  const { mediaId } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const file = await getMediaByIdOrThrow(db, siteId, mediaId, 'Media not found', { originalName: true, url: true, mimeType: true })

  const prompt = `Generate alt text for an image with filename: "${file.originalName}"`

  const { text } = await callAiOrThrow(() =>
    generateText({ model, system: SYSTEM, prompt, maxOutputTokens: 100 }),
  )
  return { altText: text.trim() }
})
