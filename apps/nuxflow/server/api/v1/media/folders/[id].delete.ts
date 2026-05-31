import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { mediaFolders, media } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const folder = await db.query.mediaFolders.findFirst({
    where: and(eq(mediaFolders.id, id), eq(mediaFolders.siteId, siteId)),
  })
  if (!folder) throw createError({ statusCode: 404, message: 'Folder not found' })

  // Move files in this folder back to root rather than deleting them
  await db.update(media)
    .set({ folderId: null })
    .where(and(eq(media.siteId, siteId), eq(media.folderId, id)))

  await db.delete(mediaFolders)
    .where(and(eq(mediaFolders.id, id), eq(mediaFolders.siteId, siteId)))

  return { success: true }
})
