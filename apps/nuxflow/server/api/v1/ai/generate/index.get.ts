import { requireRole } from '../../../../utils/permissions'
import { useDb } from '../../../../utils/db'
import { aiGenerationJobs } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

/**
 * Recent generation jobs on this site (the Generate with AI page's history, which is also
 * how an unfinished job is resumed). Editor+, like every other generation route.
 */
export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const jobs = await db.query.aiGenerationJobs.findMany({
    where: eq(aiGenerationJobs.siteId, siteId),
    columns: { id: true, siteId: true, userId: true, prompt: true, type: true, status: true, generatedCount: true, totalCount: true, error: true, createdAt: true, updatedAt: true },
    orderBy: [desc(aiGenerationJobs.createdAt)],
    limit: 50,
  })

  return { jobs }
})
