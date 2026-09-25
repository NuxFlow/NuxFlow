import { generateObject } from 'ai'
import { z } from 'zod'
import { ulid } from 'ulid'
import type { H3Event } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { useDb, type Db } from './db'
import { requireAiSdkModel, callAiOrThrow } from './ai-sdk'
import { generateCanvasBlocks } from './canvas-generation'
import { getContentTypeBySlugOrThrow, uniqueContentSlug } from './content-queries'
import { aiGenerationJobs, contentItems } from '@nuxflow/db/schema'

// Backs the job-queue multi-page "Generate site…" flow (POST /api/v1/ai/generate,
// GET .../:jobId, POST .../:jobId/approve) — the ai_generation_jobs table has existed,
// fully migrated, since the baseline schema but nothing wrote to it until now (see
// docs/roadmap.md's "AI Page & Site Generation" section for the original design this
// implements). Single-page generation (generate-canvas.post.ts, the editor's "Generate
// page…" modal) stays synchronous and untouched — it's fast enough not to need a job; this
// is specifically for the slower, multi-call, unattended multi-page case.

const planSchema = z.object({
  pages: z.array(z.object({
    title: z.string().max(200),
    slug: z.string().max(200).describe('URL-safe slug: lowercase, hyphenated, no leading slash. Use "home" for the homepage.'),
    description: z.string().max(400).describe('What this page should contain — fed directly into the per-page block generator, so be specific about sections/content, not just the page name.'),
  })).min(1).max(10),
})

const PLAN_SYSTEM = `You are a website information architect. Given a description of a desired website, produce a plan: a list of pages that together form a complete, coherent small site. A typical site needs a home page plus whichever of about/services/pricing/contact/blog genuinely fit the description — don't pad the plan with pages that don't make sense for the described site. Each page's description should be specific enough to hand directly to a page-layout generator.`

async function markFailed(db: Db, jobId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : 'Site generation failed'
  console.error(`[site-generation] Job ${jobId} failed:`, err)
  await db.update(aiGenerationJobs)
    .set({ status: 'failed', error: message, updatedAt: sql`(datetime('now'))` })
    .where(eq(aiGenerationJobs.id, jobId))
}

/**
 * Phase 1 — generates the page plan for a 'site' job and stores it on the job row. Status
 * stays 'planning' throughout (matches the schema's enum — a non-null `plan` on a
 * 'planning'-status job is exactly what "ready for review" means; there's no separate
 * "plan ready" state). The editor reviews the plan client-side and calls approveSiteJob()
 * below to actually generate pages — nothing here writes a single content_items row yet.
 */
export async function generateSitePlan(event: H3Event, jobId: string): Promise<void> {
  const db = useDb(event)
  const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, jobId) })
  if (!job) return

  try {
    const model = await requireAiSdkModel(event, 'smart', { userId: job.userId })
    const { object } = await callAiOrThrow(() =>
      generateObject({ model, schema: planSchema, system: PLAN_SYSTEM, prompt: `Plan a site for: "${job.prompt}"` }),
    )
    await db.update(aiGenerationJobs)
      .set({ plan: object.pages, totalCount: object.pages.length, updatedAt: sql`(datetime('now'))` })
      .where(eq(aiGenerationJobs.id, jobId))
  } catch (err) {
    await markFailed(db, jobId, err)
  }
}

/**
 * Phase 2 — generates every planned page's canvas blocks and inserts each as a draft
 * content item, one at a time (not Promise.all — bounds how many concurrent AI calls and
 * D1 writes a single job can fan out into, same reasoning as MAX_IMAGES_PER_RUN in
 * bulk-alt-text.post.ts). Progress (`generatedCount`/`contentItemIds`) is persisted after
 * every page, not just at the end, so a poller sees real incremental progress and a job
 * that dies partway through (Worker restart, CPU limit) still leaves whatever pages did
 * complete as usable drafts rather than losing the whole batch. A single page's generation
 * failure is logged and skipped, not fatal to the job — a partial site is still useful.
 */
export async function generateSitePages(event: H3Event, jobId: string): Promise<void> {
  const db = useDb(event)
  const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, jobId) })
  if (!job || !job.plan?.length) return

  try {
    const model = await requireAiSdkModel(event, 'smart', { userId: job.userId })
    const type = await getContentTypeBySlugOrThrow(db, job.siteId, 'page', 'Content type not found')

    const contentItemIds: string[] = []
    let generatedCount = 0

    for (const page of job.plan) {
      try {
        const content = await generateCanvasBlocks(model, page.description, 'professional', 'general')
        const slug = await uniqueContentSlug(db, job.siteId, page.slug)
        const id = ulid()
        await db.insert(contentItems).values({
          id,
          siteId: job.siteId,
          typeId: type.id,
          authorId: job.userId,
          title: page.title,
          slug,
          status: 'draft',
          content,
        })
        contentItemIds.push(id)
      } catch (err) {
        console.error(`[site-generation] Job ${jobId}: failed to generate page "${page.title}":`, err)
      }
      generatedCount++
      await db.update(aiGenerationJobs)
        .set({ generatedCount, contentItemIds, updatedAt: sql`(datetime('now'))` })
        .where(eq(aiGenerationJobs.id, jobId))
    }

    await db.update(aiGenerationJobs)
      .set({ status: 'complete', updatedAt: sql`(datetime('now'))` })
      .where(eq(aiGenerationJobs.id, jobId))
  } catch (err) {
    await markFailed(db, jobId, err)
  }
}
