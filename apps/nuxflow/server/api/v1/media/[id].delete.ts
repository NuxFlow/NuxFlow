import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getActiveProvider } from '../../../utils/media-providers/index'
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

  const provider = await getActiveProvider(event)
  // Deliberately not wrapped to swallow a failure — if the remote blob can't actually be
  // removed, the D1 row must not be deleted either, or the blob orphans in storage with
  // no record left to retry against. Surfaced as a clear 502 rather than a bare 500.
  try {
    await provider.delete(file.storageKey)
  } catch (err) {
    throw createError({ statusCode: 502, message: mediaErrorMessage(err) })
  }
  const mediaDelete = db.delete(media).where(scopedById(media.id, id, media.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'media',
    resourceId: id,
    before: { originalName: file.originalName, storageKey: file.storageKey, mimeType: file.mimeType },
  })
  await batchWithAudit(db, [mediaDelete], auditInsert)

  return noContent(event)
})
