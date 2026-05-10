import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { media } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const files = await db.query.media.findMany({
    where: eq(media.siteId, siteId),
    orderBy: [desc(media.createdAt)],
  })

  return { files }
})
