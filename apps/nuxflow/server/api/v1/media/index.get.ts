import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { parsePagination } from '../../../utils/pagination'
import { paginate } from '@nuxflow/db/queries'
import { media } from '@nuxflow/db/schema'
import { and, eq, isNull, desc, sql } from 'drizzle-orm'

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

  const where = folderFilter
    ? and(eq(media.siteId, siteId), folderFilter)!
    : eq(media.siteId, siteId)

  const { page, limit, offset } = parsePagination(query, 60)

  const { items: files, total } = await paginate(
    () => db.select({ total: sql<number>`count(*)` }).from(media).where(where),
    () => db.query.media.findMany({ where, orderBy: [desc(media.createdAt)], limit, offset }),
  )

  return { files, page, limit, total }
})
