import { requireAuth } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

/** Admin → AI Generations history — every job (page or site) ever created on this site. */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const jobs = await db.query.aiGenerationJobs.findMany({
    where: eq(aiGenerationJobs.siteId, siteId),
    orderBy: [desc(aiGenerationJobs.createdAt)],
    limit: 50,
  })

  return { jobs }
})
