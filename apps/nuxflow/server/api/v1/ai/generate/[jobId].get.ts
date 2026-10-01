import { requireRole } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { jobResponse } from '../../../../utils/site-generation'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

// Editor+, matching who can create jobs — a job carries its prompt and the generated
// drafts' full content, which a member/viewer of the site has no business reading.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const siteId = event.context.siteId as string
  const jobId = getRouterParam(event, 'jobId')!
  const db = useDb(event)

  const job = await db.query.aiGenerationJobs.findFirst({
    where: and(eq(aiGenerationJobs.id, jobId), eq(aiGenerationJobs.siteId, siteId)),
  })
  if (!job) throw notFound('Generation job not found')

  return jobResponse(db, job)
})
