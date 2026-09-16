import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { mediaFolders, media } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { scopedById } from '../../../../utils/db-helpers'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const folder = await db.query.mediaFolders.findFirst({
    where: scopedById(mediaFolders.id, id, mediaFolders.siteId, siteId),
  })
  if (!folder) throw notFound('Folder not found')

  // Move files in this folder back to root rather than deleting them
  const unfileMedia = db.update(media)
    .set({ folderId: null })
    .where(and(eq(media.siteId, siteId), eq(media.folderId, id)))

  // Promote any subfolders to root level rather than leaving them pointing at a
  // deleted parent id — mediaFolders.parentId has no DB-level FK (see the schema
  // comment for why: the required table-rebuild migration would silently null every
  // parentId in the table via its own ON DELETE SET NULL action mid-migration), so this
  // is the only thing preventing a dangling reference here.
  const reparentSubfolders = db.update(mediaFolders)
    .set({ parentId: null })
    .where(and(eq(mediaFolders.siteId, siteId), eq(mediaFolders.parentId, id)))

  const folderDelete = db.delete(mediaFolders)
    .where(scopedById(mediaFolders.id, id, mediaFolders.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'media_folder',
    resourceId: id,
    before: folder,
  })

  await batchWithAudit(db, [unfileMedia, reparentSubfolders, folderDelete], auditInsert)

  return noContent(event)
})
