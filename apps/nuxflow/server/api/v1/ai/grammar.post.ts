import { z } from 'zod'
import { generateObject } from 'ai'
import { requireAuth } from '../../../utils/permissions'
import { requireAiSdkModel, aiErrorMessage } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  text: z.string().min(1).max(10000),
})

const correctionSchema = z.object({
  corrections: z.array(z.object({
    original: z.string(),
    corrected: z.string(),
    reason: z.string(),
  })),
})

const SYSTEM = `You are a grammar and style editor. Identify grammar errors, spelling mistakes, awkward phrasing, and style improvements in the provided text.

For each issue found:
- "original": the exact problematic phrase (copy it verbatim from the input)
- "corrected": the suggested replacement
- "reason": a short explanation (max 10 words)

Only flag genuine issues. Return an empty corrections array if the text is already well-written.`

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-grammar' })

  const model = await requireAiSdkModel(event, 'fast')

  const { text } = await parseBody(event, bodySchema)

  try {
    const { object } = await generateObject({
      model,
      schema: correctionSchema,
      system: SYSTEM,
      prompt: `Check this text for grammar and style issues:\n\n${text}`,
    })
    return object
  } catch (err) {
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }
})
