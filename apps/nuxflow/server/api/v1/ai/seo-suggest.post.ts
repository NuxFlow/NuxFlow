import { z } from 'zod'
import { requireAuth } from '../../../utils/permissions'
import { getAiProvider } from '../../../utils/ai-providers/index'

const bodySchema = z.object({
  title: z.string().min(1),
  body: z.string().max(8000).optional(),
})

const SYSTEM = `You are an SEO expert. Return ONLY valid JSON with keys "title" (max 60 chars) and "description" (max 160 chars). No other text.`

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const ai = getAiProvider()
  if (!ai) throw createError({ statusCode: 503, message: 'No AI provider configured' })

  const { title, body } = await readValidatedBody(event, bodySchema.parse)
  const prompt = `Generate an SEO title and meta description for this content:\nTitle: ${title}\n${body ? `Content: ${body.slice(0, 2000)}` : ''}`

  const raw = await ai.complete(prompt, { systemPrompt: SYSTEM, maxTokens: 300 })

  try {
    const { title: seoTitle, description } = JSON.parse(raw) as { title: string; description: string }
    return { seoTitle, seoDescription: description }
  } catch {
    return { seoTitle: title, seoDescription: '' }
  }
})
