import { z } from 'zod'
import { generateObject } from 'ai'
import { contentItems, sites } from '@nuxflow/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { requireRole } from '../../../utils/permissions'
import { requireAiSdkModel, callAiOrThrow } from '../../../utils/ai-sdk'
import { rateLimit } from '../../../utils/rate-limit'
import { useDb } from '../../../utils/db'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentToMarkdown } from '../../../utils/markdown'
import { clampToWords } from '../../../utils/seo'

const bodySchema = z.object({
  title: z.string().max(300).default(''),
  body: z.string().max(8000).optional(),
  // Generate from a saved content item's actual body (server-side, so Canvas pages work
  // too — the editor only has rendered HTML for prose pages).
  contentId: z.string().max(64).optional(),
  // Generate the site-wide homepage title/description from the site's own content.
  scope: z.enum(['page', 'site']).default('page'),
}).refine(b => b.title || b.contentId || b.scope === 'site', { message: 'title, contentId, or scope "site" is required' })

// Deliberately no .max() here: generateObject enforces the schema at the provider-call
// level, so a model returning 62 characters used to fail the whole call with a 502. The
// limits are asked for in the prompt and enforced by clampToWords() (utils/seo.ts) instead.
const seoSchema = z.object({
  title: z.string().describe('SEO title, at most 60 characters'),
  description: z.string().describe('Meta description, at most 155 characters'),
})

const SYSTEM = `You are an SEO and GEO (generative engine optimization) expert. Write an SEO title (at most 60 characters) and meta description (at most 155 characters) that accurately summarize the given content, lead with its main topic, and read naturally — no clickbait, no keyword stuffing, no quotation marks around the output. Write in the same language as the content.`

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  // Single generateObject call, same order of magnitude as grammar.post.ts/
  // generate-content.post.ts (both 15/min).
  await rateLimit(event, { limit: 15, windowMs: 60_000, keyPrefix: 'ai-seo' })
  const model = await requireAiSdkModel(event, 'fast', { userId })

  const input = await parseBody(event, bodySchema)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  let title = input.title
  let content = input.body ?? ''

  if (input.scope === 'site') {
    const [site, recent] = await Promise.all([
      db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true } }),
      db.query.contentItems.findMany({
        where: and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public')),
        orderBy: [desc(contentItems.publishedAt)],
        limit: 20,
        columns: { title: true, excerpt: true, seoDescription: true },
      }),
    ])
    title = title || site?.name || ''
    content = [
      `This is the homepage of the website "${site?.name ?? title}".`,
      content && `Current description: ${content}`,
      recent.length ? `Its recent pages and posts:\n${recent.map(r => `- ${r.title}${r.seoDescription || r.excerpt ? `: ${r.seoDescription || r.excerpt}` : ''}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')
  } else if (input.contentId) {
    const item = await getContentItemOrThrow(db, siteId, input.contentId, 'Content not found', { title: true, content: true, excerpt: true })
    title = title || item.title
    content = content || [item.excerpt, contentToMarkdown(item.content)].filter(Boolean).join('\n\n')
  }

  const prompt = `Generate an SEO title and meta description.\nTitle: ${title}\n${content ? `Content:\n${content.slice(0, 4000)}` : ''}`

  const { object } = await callAiOrThrow(() =>
    generateObject({ model, schema: seoSchema, system: SYSTEM, prompt, maxOutputTokens: 300 }),
  )

  return { seoTitle: clampToWords(object.title, 60), seoDescription: clampToWords(object.description, 160) }
})
