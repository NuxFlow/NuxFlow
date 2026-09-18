import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  text: z.string().min(1).max(5000),
  instruction: z.enum(['improve', 'shorten', 'expand', 'simplify']).default('improve'),
})

// generateObject (Vercel AI SDK) enforces this schema at the provider-call level instead of
// hoping the model's free-text response happens to be valid JSON — same pattern as
// grammar.post.ts/generate-canvas.post.ts. The previous generateText + manual JSON.parse
// approach had a known failure mode: seo-suggest.post.ts's sibling had already needed a
// code-fence-stripping workaround for "the model doesn't always comply," and this route had
// the same exposure without ever getting the same fix.
const alternativesSchema = z.object({
  alternatives: z.array(z.string()).length(3),
})

const SYSTEM = `You are a helpful writing assistant. Generate exactly 3 alternative versions of the given text.`

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'ai' })

  const model = await requireAiSdkModel(event, 'fast')

  const { text, instruction } = await parseBody(event, bodySchema)

  const instructions: Record<string, string> = {
    improve: 'Improve this text for clarity and impact',
    shorten: 'Shorten this text while keeping the core meaning',
    expand: 'Expand this text with more detail',
    simplify: 'Simplify this text for a general audience',
  }

  const prompt = `${instructions[instruction]}:\n\n${text}`

  const { object } = await callAiOrThrow(() =>
    generateObject({ model, schema: alternativesSchema, system: SYSTEM, prompt, maxOutputTokens: 800, temperature: 0.8 }),
  )

  return object
})
