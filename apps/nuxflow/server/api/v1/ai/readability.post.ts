import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  html: z.string().min(1).max(20000),
})

const readabilitySchema = z.object({
  score: z.number().min(0).max(100).describe('0-100 Flesch-Kincaid-style reading ease score — higher is easier to read'),
  gradeLevel: z.string().describe('Approximate US school grade level needed to easily understand this text, e.g. "8th grade", "College"'),
  issues: z.array(z.object({
    type: z.enum(['long_sentence', 'passive_voice', 'jargon', 'long_paragraph', 'weak_wording']),
    excerpt: z.string().max(200).describe('The exact problematic snippet, verbatim from the text'),
    suggestion: z.string().max(300),
  })).max(8),
  summary: z.string().max(300).describe('One or two sentences summarizing the overall readability'),
})

const SYSTEM = `You are a readability and content-quality analyst, in the style of Flesch-Kincaid scoring and tools like Yoast SEO's readability check. You are given plain text (HTML tags already stripped) from a web page or blog post. Score how easy it is for a general web audience to read, and flag the most impactful specific issues (long/complex sentences, passive voice, jargon, long paragraphs, weak wording) with the exact excerpt and a concrete fix. Prioritize the highest-impact issues — don't flag minor nitpicks if the text is already good.`

/**
 * HTML tags stripped with a regex, not a real parser — same "good enough, zero dependency"
 * spirit as exif.ts/image-dimensions.ts. A readability score doesn't need perfect markup
 * awareness, just the visible text; entity decoding is intentionally skipped too (a stray
 * `&amp;` or `&nbsp;` in the model's input doesn't meaningfully change a readability score).
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-readability' })
  const model = await requireAiSdkModel(event, 'fast', { userId })

  const { html } = await parseBody(event, bodySchema)
  const text = stripHtml(html)
  if (!text) return { score: 100, gradeLevel: 'N/A', issues: [], summary: 'No text content to analyze.' }

  const { object } = await callAiOrThrow(() =>
    generateObject({
      model,
      schema: readabilitySchema,
      system: SYSTEM,
      prompt: `Analyze the readability of this text:\n\n${text.slice(0, 6000)}`,
      maxOutputTokens: 800,
    }),
  )

  return object
})
