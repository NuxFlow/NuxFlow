import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { getVideoAssetByIdOrThrow } from '../../../../utils/resource-queries'
import { videoAssets } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  const asset = await getVideoAssetByIdOrThrow(db, siteId, id)

  const body = await readBody(event)
  const title = body?.title as string | undefined

  if (!title || title.trim() === '') {
    throw badRequest('Title is required')
  }

  await db.update(videoAssets)
    .set({ title: title.trim() })
    .where(and(eq(videoAssets.id, id), eq(videoAssets.siteId, siteId)))

  void writeAuditLog(event, userId, {
    action: 'update',
    resource: 'video_assets',
    resourceId: id,
    before: { title: asset.title },
    after: { title: title.trim() },
  })

  return { success: true }
})
