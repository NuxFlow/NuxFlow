import { z } from 'zod'
import { requireAuth } from '../../../utils/permissions'
import { getAiProvider } from '../../../utils/ai-providers/index'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  text: z.string().min(1).max(5000),
  instruction: z.enum(['improve', 'shorten', 'expand', 'simplify']).default('improve'),
})

const SYSTEM = `You are a helpful writing assistant. Return ONLY a JSON array of 3 improved alternatives, no other text. Example: ["Alt 1", "Alt 2", "Alt 3"]`

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'ai' })

  const ai = await getAiProvider(event)
  if (!ai) throw createError({ statusCode: 503, message: 'No AI provider configured' })

  const { text, instruction } = await readValidatedBody(event, bodySchema.parse)

  const instructions: Record<string, string> = {
    improve: 'Improve this text for clarity and impact',
    shorten: 'Shorten this text while keeping the core meaning',
    expand: 'Expand this text with more detail',
    simplify: 'Simplify this text for a general audience',
  }

  const prompt = `${instructions[instruction]}:\n\n${text}`
  const raw = await ai.complete(prompt, { systemPrompt: SYSTEM, maxTokens: 800, temperature: 0.8 })

  let alternatives: string[]
  try {
    alternatives = JSON.parse(raw)
  } catch {
    alternatives = [raw]
  }

  return { alternatives }
})
