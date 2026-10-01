import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { fleschScores, gradeLabel, isLikelyEnglish } from '../../../utils/readability'

const bodySchema = z.object({
  html: z.string().min(1).max(20000),
})

const readabilitySchema = z.object({
  // Only used for non-English text — English is scored with the real Flesch formulas
  // (utils/readability.ts), which give the same number every time for the same text.
  score: z.number().min(0).max(100).describe('0-100 reading ease estimate — higher is easier to read'),
  gradeLevel: z.string().describe('Approximate school grade level needed to easily understand this text, e.g. "8th grade", "College"'),
  issues: z.array(z.object({
    type: z.enum(['long_sentence', 'passive_voice', 'jargon', 'long_paragraph', 'weak_wording']),
    excerpt: z.string().max(200).describe('The exact problematic snippet, verbatim from the text'),
    suggestion: z.string().max(300),
  })).max(8),
  summary: z.string().max(300).describe('One or two sentences summarizing the overall readability'),
})

const SYSTEM = `You are a readability and content-quality analyst, in the style of tools like Yoast SEO's readability check. You are given plain text (HTML tags already stripped) from a web page or blog post. Estimate how easy it is for a general web audience to read, and flag the most impactful specific issues (long/complex sentences, passive voice, jargon, long paragraphs, weak wording) with the exact excerpt and a concrete fix. Prioritize the highest-impact issues — don't flag minor nitpicks if the text is already good. Write the summary and suggestions in the same language as the text.`

/**
 * HTML tags stripped with a regex, not a real parser — same "good enough, zero dependency"
 * spirit as exif.ts/image-dimensions.ts. A readability score doesn't need perfect markup
 * awareness, just the visible text; entity decoding is intentionally skipped too (a stray
 * `&amp;` or `&nbsp;` in the model's input doesn't meaningfully change a readability score).
 */
function stripHtml(html: string): string {
  // Block elements end a sentence even without punctuation (headings, list items) —
  // otherwise they'd merge into one long "sentence" and skew the Flesch score.
  return html
    .replace(/<\/(?:p|h[1-6]|li|blockquote|div|td|th)>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

  if (!isLikelyEnglish(text)) return { ...object, method: 'ai-estimate' as const }

  const scores = fleschScores(text)!
  return { ...object, score: scores.readingEase, gradeLevel: gradeLabel(scores.grade), method: 'flesch' as const }
})
