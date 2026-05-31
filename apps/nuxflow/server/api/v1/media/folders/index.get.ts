import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { mediaFolders, media } from '@nuxflow/db/schema'
import { eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const folders = await db.query.mediaFolders.findMany({
    where: eq(mediaFolders.siteId, siteId),
    orderBy: (t, { asc }) => [asc(t.name)],
  })

  // Count files per folder in one query
  const counts = await db
    .select({ folderId: media.folderId, count: sql<number>`count(*)` })
    .from(media)
    .where(eq(media.siteId, siteId))
    .groupBy(media.folderId)

  const countMap = Object.fromEntries(counts.map(r => [r.folderId ?? '__null__', r.count]))

  return {
    folders: folders.map(f => ({ ...f, fileCount: countMap[f.id] ?? 0 })),
    unfolderedCount: countMap['__null__'] ?? 0,
  }
})
