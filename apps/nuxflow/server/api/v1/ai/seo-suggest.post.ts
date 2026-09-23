import { z } from 'zod'
import { generateObject } from 'ai'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  title: z.string().min(1),
  body: z.string().max(8000).optional(),
})

// generateObject enforces this schema at the provider-call level instead of manually
// JSON.parse-ing a free-text response (which needed its own code-fence-stripping workaround
// — "the model doesn't always comply" — before this; see translate.post.ts for the same
// class of problem in a route that hasn't been converted). A schema-generation failure now
// surfaces as a clear 502 via callAiOrThrow rather than silently shipping a blank meta
// description, which is arguably a worse outcome for SEO than an explicit error.
const seoSchema = z.object({
  title: z.string().max(60),
  description: z.string().max(160),
})

const SYSTEM = `You are an SEO expert. Generate an SEO title (max 60 characters) and meta description (max 160 characters) for the given content.`

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  // Single generateObject call, same order of magnitude as grammar.post.ts/
  // generate-content.post.ts (both 15/min) — this route previously had no rate limit at all.
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-seo' })
  const model = await requireAiSdkModel(event, 'fast', { userId })

  const { title, body } = await parseBody(event, bodySchema)
  const prompt = `Generate an SEO title and meta description for this content:\nTitle: ${title}\n${body ? `Content: ${body.slice(0, 2000)}` : ''}`

  const { object } = await callAiOrThrow(() =>
    generateObject({ model, schema: seoSchema, system: SYSTEM, prompt, maxOutputTokens: 300 }),
  )

  return { seoTitle: object.title, seoDescription: object.description }
})
