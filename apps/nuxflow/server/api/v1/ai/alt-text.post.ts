import { z } from 'zod'
import { generateText } from 'ai'
import { requireAuth } from '../../../utils/permissions'
import { getAiSdkModel, aiErrorMessage } from '../../../utils/ai-sdk'
import { useDb } from '../../../utils/db'
import { media } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({ mediaId: z.string() })

const SYSTEM = `You are an accessibility expert. Write concise, descriptive alt text for an image. Return ONLY the alt text string, no quotes, no explanation.`

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const model = await getAiSdkModel(event, 'fast')
  if (!model) throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })

  const { mediaId } = await readValidatedBody(event, bodySchema.parse)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const file = await db.query.media.findFirst({
    where: and(eq(media.id, mediaId), eq(media.siteId, siteId))!,
    columns: { originalName: true, url: true, mimeType: true },
  })
  if (!file) throw createError({ statusCode: 404, message: 'Media not found' })

  const prompt = `Generate alt text for an image with filename: "${file.originalName}"`

  try {
    const { text } = await generateText({ model, system: SYSTEM, prompt, maxOutputTokens: 100 })
    return { altText: text.trim() }
  } catch (err) {
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }
})
