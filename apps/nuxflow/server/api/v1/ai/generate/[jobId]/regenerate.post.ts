import { z } from 'zod'
import { requireRole } from '../../../../../utils/permissions'
import { requireAiSdkModel } from '../../../../../utils/ai-sdk'
import { rateLimit } from '../../../../../utils/rate-limit'
import { useDb } from '../../../../../utils/db'
import { claimJob, jobResponse, regeneratePlanPage, releaseJob } from '../../../../../utils/site-generation'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireSiteId } from '../../../../../utils/site-context'

const bodySchema = z.object({ index: z.number().int().min(0) })

/** Regenerates one page of a finished job — the review screen's "Regenerate" / "Retry". */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'ai-generate-regenerate' })
  await requireAiSdkModel(event, 'smart', { userId })

  const siteId = requireSiteId(event)
  const jobId = getRouterParam(event, 'jobId')!
  const db = useDb(event)
  const { index } = await parseBody(event, bodySchema)

  const job = await claimJob(db, siteId, jobId)
  if (!job) {
    const exists = await db.query.aiGenerationJobs.findFirst({ where: and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.siteId, siteId)), columns: { id: true } })
    if (!exists) throw notFound('Generation job not found')
    throw conflict('This generation is busy — wait for the current step to finish')
  }

  try {
    if (job.status !== 'complete') throw conflict('Pages can be regenerated once the generation has finished')
    await regeneratePlanPage(event, db, job, index)
  }
  finally {
    await releaseJob(db, siteId, jobId)
  }

  const updated = await db.query.aiGenerationJobs.findFirst({ where: and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.siteId, siteId)) })
  return jobResponse(db, updated!)
})
