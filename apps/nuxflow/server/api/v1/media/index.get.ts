import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { media } from '@nuxflow/db/schema'
import { and, eq, isNull, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)

  const folderFilter = query.folderId !== undefined
    ? (query.folderId === 'null' || query.folderId === '')
      ? isNull(media.folderId)
      : eq(media.folderId, query.folderId as string)
    : undefined

  const files = await db.query.media.findMany({
    where: folderFilter
      ? and(eq(media.siteId, siteId), folderFilter)
      : eq(media.siteId, siteId),
    orderBy: [desc(media.createdAt)],
  })

  return { files }
})
