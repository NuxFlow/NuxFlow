import { z } from 'zod'
import { requireAuth } from '../../../utils/permissions'
import { getAiProvider } from '../../../utils/ai-providers/index'
import { useDb } from '../../../utils/db'
import { media } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({ mediaId: z.string() })

const SYSTEM = `You are an accessibility expert. Write concise, descriptive alt text for an image. Return ONLY the alt text string, no quotes, no explanation.`

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const ai = getAiProvider()
  if (!ai) throw createError({ statusCode: 503, message: 'No AI provider configured' })

  const { mediaId } = await readValidatedBody(event, bodySchema.parse)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const file = await db.query.media.findFirst({
    where: and(eq(media.id, mediaId), eq(media.siteId, siteId)),
    columns: { originalName: true, url: true, mimeType: true },
  })
  if (!file) throw createError({ statusCode: 404, message: 'Media not found' })

  const prompt = `Generate alt text for an image with filename: "${file.originalName}"`
  const altText = await ai.complete(prompt, { systemPrompt: SYSTEM, maxTokens: 100 })

  return { altText: altText.trim() }
})
