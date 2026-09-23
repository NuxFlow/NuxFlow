import { requireRole } from '../../../../../utils/permissions'
import { rateLimit } from '../../../../../utils/rate-limit'
import { useDb } from '../../../../../utils/db'
import { waitUntil } from '../../../../../utils/cf-env'
import { generateSitePages } from '../../../../../utils/site-generation'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'

/**
 * Approves a 'site' job's plan and kicks off page generation. Only valid from 'planning'
 * status with a plan already present — a 'page' job (no plan step at all) or a job already
 * approved/generating/complete/failed 404s here rather than silently no-op-ing, so a
 * double-click or a stale poll response can't accidentally re-trigger generation.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-generate-approve' })

  const siteId = event.context.siteId as string
  const jobId = getRouterParam(event, 'jobId')!
  const db = useDb(event)

  const job = await db.query.aiGenerationJobs.findFirst({
    where: and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.siteId, siteId)),
  })
  if (!job || job.status !== 'planning' || !job.plan?.length) {
    throw notFound('Generation job not found, or not awaiting approval')
  }

  await db.update(aiGenerationJobs)
    .set({ status: 'generating', updatedAt: sql`(datetime('now'))` })
    .where(eq(aiGenerationJobs.id, jobId))

  waitUntil(event, generateSitePages(event, jobId))

  return { status: 'generating' }
})
