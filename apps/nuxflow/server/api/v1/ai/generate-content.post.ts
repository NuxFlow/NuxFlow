import { z } from 'zod'
import { generateText } from 'ai'
import { requireAuth } from '../../../utils/permissions'
import { getAiSdkModel, aiErrorMessage } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  description: z.string().min(5).max(500),
  tone: z.enum(['professional', 'casual', 'friendly', 'technical']).optional().default('professional'),
  format: z.enum(['prose', 'listicle', 'howto', 'faq']).optional().default('prose'),
})

const SYSTEM = `You are a professional content writer. Generate well-structured HTML content for a CMS rich text editor.

Rules:
- Return ONLY the HTML, no preamble, no markdown fences
- Use semantic HTML: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>
- Do NOT use <h1> (the page title is used for that)
- Do NOT include <html>, <head>, or <body> tags
- Write 3-6 paragraphs or equivalent structured content
- Make it compelling, specific, and well-organized`

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  prose: 'Write as flowing prose with paragraphs.',
  listicle: 'Structure as a listicle with an intro paragraph followed by an ordered or unordered list of key points, each with a brief explanation.',
  howto: 'Structure as a step-by-step how-to guide with numbered steps.',
  faq: 'Structure as a series of questions (h3) and answers (p).',
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-content' })

  const model = await getAiSdkModel(event, 'fast')
  if (!model) throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })

  const { description, tone, format } = await parseBody(event, bodySchema)

  const prompt = `Write ${tone} content about: "${description}". ${FORMAT_INSTRUCTIONS[format]}`

  try {
    const { text } = await generateText({
      model,
      system: SYSTEM,
      prompt,
      maxOutputTokens: 1500,
    })
    return { html: text.trim() }
  } catch (err) {
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }
})
