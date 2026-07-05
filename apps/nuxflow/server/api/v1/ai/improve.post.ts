import { z } from 'zod'
import { generateText } from 'ai'
import { requireAuth } from '../../../utils/permissions'
import { getAiSdkModel, aiErrorMessage } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  text: z.string().min(1).max(5000),
  instruction: z.enum(['improve', 'shorten', 'expand', 'simplify']).default('improve'),
})

const SYSTEM = `You are a helpful writing assistant. Return ONLY a JSON array of 3 improved alternatives, no other text. Example: ["Alt 1", "Alt 2", "Alt 3"]`

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'ai' })

  const model = await getAiSdkModel(event, 'fast')
  if (!model) throw createError({ statusCode: 503, message: 'No AI provider configured. Add an API key in Settings → AI.' })

  const { text, instruction } = await readValidatedBody(event, bodySchema.parse)

  const instructions: Record<string, string> = {
    improve: 'Improve this text for clarity and impact',
    shorten: 'Shorten this text while keeping the core meaning',
    expand: 'Expand this text with more detail',
    simplify: 'Simplify this text for a general audience',
  }

  const prompt = `${instructions[instruction]}:\n\n${text}`

  let raw: string
  try {
    const { text: result } = await generateText({ model, system: SYSTEM, prompt, maxOutputTokens: 800, temperature: 0.8 })
    raw = result
  } catch (err) {
    throw createError({ statusCode: 502, message: aiErrorMessage(err) })
  }

  let alternatives: string[]
  try {
    alternatives = JSON.parse(raw) as string[]
  } catch {
    alternatives = [raw]
  }

  return { alternatives }
})
