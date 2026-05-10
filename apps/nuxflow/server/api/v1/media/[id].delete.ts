import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { media } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const file = await db.query.media.findFirst({
    where: and(eq(media.id, id), eq(media.siteId, siteId)),
  })
  if (!file) throw createError({ statusCode: 404, message: 'Not found' })

  const provider = getActiveProvider()
  await provider.delete(file.storageKey)
  await db.delete(media).where(and(eq(media.id, id), eq(media.siteId, siteId)))

  void writeAuditLog(event, userId, {
    action: 'delete',
    resource: 'media',
    resourceId: id,
    before: { originalName: file.originalName, storageKey: file.storageKey, mimeType: file.mimeType },
  })

  return { success: true }
})
