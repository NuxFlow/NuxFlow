import { requireAuth } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const siteId = event.context.siteId as string
  const jobId = getRouterParam(event, 'jobId')!
  const db = useDb(event)

  const job = await db.query.aiGenerationJobs.findFirst({
    where: and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.siteId, siteId)),
  })
  if (!job) throw notFound('Generation job not found')

  return job
})
