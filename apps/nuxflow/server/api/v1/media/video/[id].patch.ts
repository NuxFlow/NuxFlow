import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getVideoAssetByIdOrThrow } from '../../../../utils/resource-queries'
import { videoAssets } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { parseBody } from '../../../../utils/validate'
import { z } from 'zod'

const bodySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  const asset = await getVideoAssetByIdOrThrow(db, siteId, id)

  const { title } = await parseBody(event, bodySchema)

  const assetUpdate = db.update(videoAssets)
    .set({ title })
    .where(scopedById(videoAssets.id, id, videoAssets.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'video_assets',
    resourceId: id,
    before: { title: asset.title },
    after: { title },
  })
  await batchWithAudit(db, [assetUpdate], auditInsert)

  return { success: true }
})
