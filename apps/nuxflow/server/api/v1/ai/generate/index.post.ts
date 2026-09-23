import { z } from 'zod'
import { ulid } from 'ulid'
import { requireRole } from '../../../../utils/permissions'
import { requireAiSdkModel } from '../../../../utils/ai-sdk'
import { rateLimit } from '../../../../utils/rate-limit'
import { useDb } from '../../../../utils/db'
import { waitUntil } from '../../../../utils/cf-env'
import { generateSitePlan } from '../../../../utils/site-generation'
import { generateCanvasBlocks } from '../../../../utils/canvas-generation'
import { getContentTypeBySlugOrThrow } from '../../../../utils/content-queries'
import { aiGenerationJobs, contentItems } from '@nuxflow/db/schema'
import { created } from '../../../../utils/response'
import { eq, sql } from 'drizzle-orm'

const bodySchema = z.object({
  prompt: z.string().min(10).max(600),
  type: z.enum(['page', 'site']).default('site'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  // Kicks off at least one AI call (a 'site' job's plan generation; a 'page' job's full
  // generation) — same order of magnitude as the other job-creating AI route
  // (generate-image.post.ts, 5/min) rather than the single-call routes' 15/min.
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'ai-generate' })
  // Fails fast with the standard 503 before a job row is even created if no provider is
  // configured — cheaper than creating a job that's destined to immediately fail.
  await requireAiSdkModel(event, 'smart', { userId })

  const { prompt, type } = await parseBody(event, bodySchema)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const id = ulid()
  await db.insert(aiGenerationJobs).values({
    id,
    siteId,
    userId,
    prompt,
    type,
    status: type === 'site' ? 'planning' : 'generating',
  })

  if (type === 'site') {
    // Two-phase: this call only produces the plan (see site-generation.ts) — actual page
    // generation waits for an explicit approve call, so the editor can review/adjust
    // before any content_items rows are created.
    waitUntil(event, generateSitePlan(event, id))
  } else {
    // 'page' jobs skip the plan-review step entirely — a single page is generated and
    // inserted directly (same generateCanvasBlocks() call generate-canvas.post.ts's
    // synchronous editor modal uses), still via a job row so it's visible in the same
    // Admin → AI Generations history as 'site' jobs, and so the caller gets the same
    // create-then-poll shape regardless of which type it requested.
    waitUntil(event, (async () => {
      try {
        const model = await requireAiSdkModel(event, 'smart', { userId })
        const content = await generateCanvasBlocks(model, prompt, 'professional', 'general')
        const type_ = await getContentTypeBySlugOrThrow(db, siteId, 'page', 'Content type not found')
        const itemId = ulid()
        const slug = `ai-${itemId.toLowerCase()}`
        await db.insert(contentItems).values({
          id: itemId,
          siteId,
          typeId: type_.id,
          authorId: userId,
          title: prompt.slice(0, 100),
          slug,
          status: 'draft',
          content,
        })
        await db.update(aiGenerationJobs)
          .set({ status: 'complete', generatedCount: 1, totalCount: 1, contentItemIds: [itemId], updatedAt: sql`(datetime('now'))` })
          .where(eq(aiGenerationJobs.id, id))
      } catch (err) {
        console.error(`[ai-generate] Job ${id} (type=page) failed:`, err)
        await db.update(aiGenerationJobs)
          .set({ status: 'failed', error: err instanceof Error ? err.message : 'Generation failed', updatedAt: sql`(datetime('now'))` })
          .where(eq(aiGenerationJobs.id, id))
      }
    })())
  }

  return created(event, { jobId: id })
})
