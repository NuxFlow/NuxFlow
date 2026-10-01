import { z } from 'zod'
import { requireRole } from '../../../../../utils/permissions'
import { rateLimit } from '../../../../../utils/rate-limit'
import { useDb } from '../../../../../utils/db'
import { dedupePlanSlugs, jobResponse, MAX_PLAN_PAGES, planPageSchema } from '../../../../../utils/site-generation'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'

const bodySchema = z.object({
  // The plan as the editor left it on the review screen (pages renamed, removed, added,
  // descriptions rewritten). Omitted = approve the AI's plan unchanged.
  pages: z.array(planPageSchema).min(1).max(MAX_PLAN_PAGES).optional(),
})

/**
 * Approves a 'site' job's plan, moving it to 'generating'; the admin page then generates
 * the pages via POST .../step. Only valid from 'planning' with a plan present — the
 * status check is part of the UPDATE itself, so a double-click can't approve twice.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-generate-approve' })

  const siteId = event.context.siteId as string
  const jobId = getRouterParam(event, 'jobId')!
  const db = useDb(event)
  const { pages } = await parseBody(event, bodySchema)

  const job = await db.query.aiGenerationJobs.findFirst({
    where: and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.siteId, siteId)),
  })
  if (!job || job.status !== 'planning' || !job.plan?.length) {
    throw notFound('Generation job not found, or not awaiting approval')
  }

  const plan = dedupePlanSlugs(pages ?? job.plan)
  const [updated] = await db.update(aiGenerationJobs)
    .set({ plan, totalCount: plan.length, generatedCount: 0, status: 'generating', updatedAt: sql`(datetime('now'))` })
    .where(and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.status, 'planning')))
    .returning()
  if (!updated) throw notFound('Generation job not found, or not awaiting approval')

  return jobResponse(db, updated)
})
