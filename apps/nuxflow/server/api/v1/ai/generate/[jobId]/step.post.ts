import { requireRole } from '../../../../../utils/permissions'
import { rateLimit } from '../../../../../utils/rate-limit'
import { useDb } from '../../../../../utils/db'
import { advanceJob, claimJob, jobResponse, releaseJob } from '../../../../../utils/site-generation'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Does the job's next unit of work inline — the plan, or one page — and returns the
 * updated job. The admin page calls this in a loop until the job needs approval or is
 * done. When another request already holds the job's lease (a second tab), this returns
 * the job unchanged with `busy: true` instead of generating the same page twice.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  // One AI call per step; a 10-page site is 11 steps. Generous enough for that, still a
  // ceiling on a runaway client loop.
  await rateLimit(event, { limit: 30, windowMs: 60_000, keyPrefix: 'ai-generate-step' })

  const siteId = event.context.siteId as string
  const jobId = getRouterParam(event, 'jobId')!
  const db = useDb(event)

  const claimed = await claimJob(db, siteId, jobId)
  if (!claimed) {
    const job = await db.query.aiGenerationJobs.findFirst({
      where: and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.siteId, siteId)),
    })
    if (!job) throw notFound('Generation job not found')
    return jobResponse(db, job)
  }

  try {
    await advanceJob(event, db, claimed)
  }
  finally {
    await releaseJob(db, jobId)
  }

  const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, jobId) })
  return jobResponse(db, job!)
})
