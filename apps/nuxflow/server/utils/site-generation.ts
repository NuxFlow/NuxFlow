import { generateObject } from 'ai'
import { z } from 'zod'
import { ulid } from 'ulid'
import type { H3Event } from 'h3'
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { aiGenerationJobs, contentItems, type AiGenerationPlanPage } from '@nuxflow/db/schema'
import type { Db } from './db'
import { requireAiSdkModel, callAiOrThrow, aiErrorMessage } from './ai-sdk'
import { generateCanvasPage, loadGenerationContext, type GenerationContext } from './canvas-generation'
import { getContentTypeBySlugOrThrow, uniqueContentSlug } from './content-queries'
import { assertContentSlugNotTaxonomy } from './taxonomy'
import { buildAuditLogInsert, batchWithAudit } from './audit'

// The Generate with AI page's jobs (POST /api/v1/ai/generate and its sub-routes).
//
// Work is driven one unit at a time by the admin page calling POST .../:jobId/step — the
// plan, then one page per call — rather than running in the background. A Worker's
// waitUntil() gets at most 30 seconds after the response is sent, shared by everything
// the request queued (https://developers.cloudflare.com/workers/runtime-apis/context/),
// which a multi-page job of 10-60 s model calls can't fit in; the background version left
// jobs stuck at "generating" forever once Cloudflare cancelled it. An HTTP request whose
// client is still connected has no wall-time limit, so each step simply runs inline.
// Every step is resumable: progress lives on the job row, so closing the tab pauses the
// job and reopening the page picks it up where it stopped.

export type AiGenerationJob = typeof aiGenerationJobs.$inferSelect

// Longer than any single model call should take; a lease left by a request that died
// (tab closed mid-call, Worker restart) expires after this and the job can be resumed.
const LEASE_MS = 3 * 60_000

export const MAX_PLAN_PAGES = 10

export const planPageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(200).describe('URL-safe slug: lowercase, hyphenated, no leading slash. Use "home" for the homepage.'),
  description: z.string().trim().min(1).max(1000).describe('What this page should contain — handed directly to the page designer, so name the specific sections and content, not just the page.'),
})

const planSchema = z.object({ pages: z.array(planPageSchema).min(1).max(MAX_PLAN_PAGES) })

const PLAN_SYSTEM = `You are a website information architect. Given a description of a website, plan the pages that together make a complete, coherent small site: a home page plus whichever of about/services/pricing/contact/blog genuinely fit — don't pad the plan with pages the site doesn't need. Give every page a unique slug ("home" for the homepage). Each description must be specific enough to hand straight to a page designer: list the sections the page needs and what each should say.`

/** Atomically takes the job's lease. Null when another request holds it (or the job isn't this site's). */
export async function claimJob(db: Db, siteId: string, jobId: string): Promise<AiGenerationJob | null> {
  const now = new Date()
  const [job] = await db.update(aiGenerationJobs)
    .set({ lockedUntil: new Date(now.getTime() + LEASE_MS).toISOString() })
    .where(and(
      eq(aiGenerationJobs.id, jobId),
      eq(aiGenerationJobs.siteId, siteId),
      or(isNull(aiGenerationJobs.lockedUntil), lt(aiGenerationJobs.lockedUntil, now.toISOString())),
    ))
    .returning()
  return job ?? null
}

async function saveJob(db: Db, jobId: string, values: Partial<AiGenerationJob>): Promise<void> {
  await db.update(aiGenerationJobs)
    .set({ ...values, updatedAt: sql`(datetime('now'))` })
    .where(eq(aiGenerationJobs.id, jobId))
}

export function releaseJob(db: Db, jobId: string): Promise<void> {
  return saveJob(db, jobId, { lockedUntil: null })
}

function isDone(page: AiGenerationPlanPage): boolean {
  return Boolean(page.contentItemId || page.error)
}

/** Picks a free slug for a generated page — never another item's, never a taxonomy's. */
async function availableSlug(db: Db, siteId: string, wanted: string): Promise<string> {
  const slug = await uniqueContentSlug(db, siteId, wanted)
  try {
    await assertContentSlugNotTaxonomy(db, siteId, slug)
    return slug
  }
  catch {
    return uniqueContentSlug(db, siteId, `${slug}-page`)
  }
}

async function generatePlan(event: H3Event, db: Db, job: AiGenerationJob): Promise<void> {
  try {
    const model = await requireAiSdkModel(event, 'smart', { userId: job.userId })
    const { object } = await callAiOrThrow(() =>
      generateObject({ model, schema: planSchema, system: PLAN_SYSTEM, prompt: `Plan a site for: """${job.prompt}"""` }),
    )
    await saveJob(db, job.id, { plan: object.pages, totalCount: object.pages.length })
  }
  catch (err) {
    console.error(`[site-generation] Job ${job.id}: planning failed:`, err)
    await saveJob(db, job.id, { status: 'failed', error: aiErrorMessage(err) })
  }
}

function pageInput(job: AiGenerationJob, page: AiGenerationPlanPage) {
  return job.type === 'site'
    ? { description: page.description, tone: job.tone ?? undefined, siteBrief: job.prompt, sitePages: job.plan?.map(p => ({ title: p.title, slug: p.slug })) }
    : { description: job.prompt, tone: job.tone ?? undefined }
}

/** Generates plan[index] and inserts it as a draft page, recording the outcome on the plan entry. */
async function generatePlanPage(event: H3Event, db: Db, job: AiGenerationJob, index: number, ctx: GenerationContext): Promise<AiGenerationPlanPage> {
  const page = job.plan![index]!
  try {
    const model = await requireAiSdkModel(event, 'smart', { userId: job.userId })
    const generated = await generateCanvasPage(model, ctx, pageInput(job, page))
    // A site job's title/slug come from the plan the editor reviewed; a single-page job
    // has no plan step, so the model names it.
    const title = (job.type === 'site' ? page.title : generated.title) || page.title || 'Untitled page'
    const slug = await availableSlug(db, job.siteId, (job.type === 'site' ? page.slug : generated.slug) || title)
    const type = await getContentTypeBySlugOrThrow(db, job.siteId, 'page', 'Content type not found')
    const id = ulid()
    const insert = db.insert(contentItems).values({
      id,
      siteId: job.siteId,
      typeId: type.id,
      authorId: job.userId,
      title,
      slug,
      status: 'draft',
      content: generated.content,
    })
    await batchWithAudit(db, [insert], buildAuditLogInsert(event, job.userId, {
      action: 'create',
      resource: 'content_item',
      resourceId: id,
      after: { source: 'ai-generation', jobId: job.id },
    }))
    return { ...page, title, slug, contentItemId: id, error: undefined }
  }
  catch (err) {
    console.error(`[site-generation] Job ${job.id}: page "${page.title}" failed:`, err)
    return { ...page, error: aiErrorMessage(err) }
  }
}

/**
 * Advances a claimed job by one unit: the plan for a 'site' job that has none yet, else
 * the next page not yet generated, else marks the job complete. A failed page is recorded
 * on its plan entry rather than failing the job — a partial site is still useful, and the
 * review screen offers a retry for that page.
 */
export async function advanceJob(event: H3Event, db: Db, job: AiGenerationJob): Promise<void> {
  if (job.status === 'planning') {
    if (!job.plan?.length) await generatePlan(event, db, job)
    return
  }
  if (job.status !== 'generating' && job.status !== 'approved') return

  const plan = job.plan ?? []
  const index = plan.findIndex(p => !isDone(p))
  if (index === -1) {
    await saveJob(db, job.id, { status: 'complete', generatedCount: plan.length })
    return
  }

  const ctx = await loadGenerationContext(event, db, job.siteId)
  const nextPlan = [...plan]
  nextPlan[index] = await generatePlanPage(event, db, job, index, ctx)
  const generatedCount = nextPlan.filter(isDone).length
  await saveJob(db, job.id, {
    plan: nextPlan,
    generatedCount,
    contentItemIds: nextPlan.flatMap(p => (p.contentItemId ? [p.contentItemId] : [])),
    ...(generatedCount === nextPlan.length && { status: 'complete' }),
  })
}

/**
 * Regenerates one page of a finished job — replacing the draft's content in place when
 * it's still a draft, or creating a fresh draft when the original was deleted, published,
 * or never generated (a failed page). A published page is never overwritten.
 */
export async function regeneratePlanPage(event: H3Event, db: Db, job: AiGenerationJob, index: number): Promise<void> {
  const plan = job.plan ?? []
  const page = plan[index]
  if (!page) throw notFound('No such page in this generation')

  const existing = page.contentItemId
    ? await db.query.contentItems.findFirst({
        where: and(eq(contentItems.id, page.contentItemId), eq(contentItems.siteId, job.siteId)),
        columns: { id: true, status: true },
      })
    : undefined

  const ctx = await loadGenerationContext(event, db, job.siteId)
  let updated: AiGenerationPlanPage

  if (existing?.status === 'draft') {
    const model = await requireAiSdkModel(event, 'smart', { userId: job.userId })
    const generated = await generateCanvasPage(model, ctx, pageInput(job, page))
    const update = db.update(contentItems)
      .set({
        content: generated.content,
        // Bumped so an editor that has this draft open notices on its next save rather
        // than silently overwriting the regenerated content (optimistic lock).
        version: sql`${contentItems.version} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(contentItems.id, existing.id), eq(contentItems.siteId, job.siteId)))
    await batchWithAudit(db, [update], buildAuditLogInsert(event, job.userId, {
      action: 'update',
      resource: 'content_item',
      resourceId: existing.id,
      after: { source: 'ai-generation', jobId: job.id, regenerated: true },
    }))
    updated = { ...page, error: undefined }
  }
  else {
    updated = await generatePlanPage(event, db, job, index, ctx)
    if (updated.error) throw createError({ statusCode: 502, message: updated.error })
  }

  const nextPlan = [...plan]
  nextPlan[index] = updated
  await saveJob(db, job.id, {
    plan: nextPlan,
    contentItemIds: nextPlan.flatMap(p => (p.contentItemId ? [p.contentItemId] : [])),
  })
}

export interface AiGenerationJobItem {
  id: string
  title: string
  slug: string
  status: string
  content: unknown
}

/**
 * The job as the admin page sees it: the row minus the lease, plus each generated draft
 * that still exists (title/slug/status/content) for the review screen's previews.
 */
export async function jobResponse(db: Db, job: AiGenerationJob) {
  const ids = (job.plan ?? []).flatMap(p => (p.contentItemId ? [p.contentItemId] : []))
  const rows = ids.length
    ? await db.query.contentItems.findMany({
        where: and(eq(contentItems.siteId, job.siteId), inArray(contentItems.id, ids)),
        columns: { id: true, title: true, slug: true, status: true, content: true },
      })
    : []
  const { lockedUntil, ...rest } = job
  return {
    ...rest,
    busy: Boolean(lockedUntil && lockedUntil > new Date().toISOString()),
    items: rows satisfies AiGenerationJobItem[],
  }
}

/** Makes every slug in an edited plan unique, so two planned pages can't collide. */
export function dedupePlanSlugs(pages: Array<{ title: string; slug: string; description: string }>): AiGenerationPlanPage[] {
  const seen = new Set<string>()
  return pages.map((p) => {
    const base = (p.slug || p.title).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'page'
    let slug = base
    for (let n = 2; seen.has(slug); n++) slug = `${base}-${n}`
    seen.add(slug)
    return { title: p.title, slug, description: p.description }
  })
}
