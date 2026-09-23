import { z } from 'zod'
import { generateText } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { semanticSearch } from '../../../utils/embeddings'

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
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-content' })

  const model = await requireAiSdkModel(event, 'fast', { userId })

  const { description, tone, format } = await parseBody(event, bodySchema)

  // Best-effort grounding in the site's own existing content (when Vectorize is configured
  // — semanticSearch returns null otherwise and this is silently skipped) so generated
  // copy doesn't blindly duplicate a page that already exists on the same topic. This is
  // deliberately lightweight (titles only, not full text) — enough to steer the model away
  // from an obvious duplicate without spending tokens re-grounding every generation in full
  // page bodies.
  const related = await semanticSearch(event, event.context.siteId as string, description, 3)
  const groundingNote = related?.length
    ? `\n\nFor context, this site already has related content titled: ${related.map(r => `"${r.title}"`).join(', ')}. Write new, non-duplicate content — don't just restate these.`
    : ''

  const prompt = `Write ${tone} content about: "${description}". ${FORMAT_INSTRUCTIONS[format]}${groundingNote}`

  const { text } = await callAiOrThrow(() =>
    generateText({
      model,
      system: SYSTEM,
      prompt,
      maxOutputTokens: 1500,
    }),
  )
  return { html: text.trim() }
})
