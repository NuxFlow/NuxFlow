import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { deleteStoredMedia } from '../../../utils/media-providers/storage-delete'
import { getMediaByIdOrThrow } from '../../../utils/resource-queries'
import { media } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { mediaErrorMessage } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const file = await getMediaByIdOrThrow(db, siteId, id)

  // Deliberately not wrapped to swallow a failure — if the remote blob can't actually be
  // removed, the D1 row must not be deleted either, or the blob orphans in storage with
  // no record left to retry against. Surfaced as a clear 502 rather than a bare 500.
  // deleteStoredMedia() targets the provider the row was stored on and refuses any key
  // outside this site's own prefix (a restored backup can carry arbitrary row values).
  let reachable: boolean
  try {
    reachable = await deleteStoredMedia(event, siteId, file)
  } catch (err) {
    throw createError({ statusCode: 502, message: mediaErrorMessage(err) })
  }
  if (!reachable) {
    // The file lives on a provider this site has since switched away from (no credentials
    // left to remove it with), or its key isn't this site's. Dropping the row is still
    // what the admin asked for; the audit entry below records the key left behind.
    console.warn(`[media] Could not delete ${file.storageKey} ('${file.storageProvider}') — removing the row only`)
  }
  const mediaDelete = db.delete(media).where(scopedById(media.id, id, media.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'media',
    resourceId: id,
    before: { originalName: file.originalName, storageKey: file.storageKey, mimeType: file.mimeType, ...(!reachable && { orphanedOn: file.storageProvider }) },
  })
  await batchWithAudit(db, [mediaDelete], auditInsert)

  return noContent(event)
})
