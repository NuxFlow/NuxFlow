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
// Not .length(3): the schema is enforced on the model's answer, and one returning 2 or 4
// failed the whole call. Three are asked for; extras are dropped below.
const alternativesSchema = z.object({
  alternatives: z.array(z.string()).min(1).max(6),
})

const SYSTEM = `You are a helpful writing assistant. Generate exactly 3 alternative versions of the given text. Write them in the same language as the text, and return only the rewritten text — no labels or commentary.`

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'ai' })

  const model = await requireAiSdkModel(event, 'fast', { userId })

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

  const alternatives = object.alternatives.map(a => a.trim()).filter(Boolean).slice(0, 3)
  if (!alternatives.length) throw createError({ statusCode: 502, message: 'The AI returned no suggestions — try again' })
  return { alternatives }
})
