import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getVideoAssetByIdOrThrow } from '../../../../utils/resource-queries'
import { videoAssets } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { requireSiteId } from '../../../../utils/site-context'
import { deleteStreamVideo, streamAccountFor } from '../../../../utils/stream'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  const asset = await getVideoAssetByIdOrThrow(db, siteId, id)

  // Like media delete: if Stream can't remove the video, keep the row (502) so there's
  // something left to retry against — Stream bills for every stored minute. A 404 means
  // it's already gone. Without credentials there's nothing to call; the row is dropped
  // and the audit entry records the video left behind.
  const account = await streamAccountFor(event, asset.streamAccount)

  if (account) {
    if (!(await deleteStreamVideo(account, asset.cloudflareStreamId))) {
      throw httpError({ status: 502, message: 'Cloudflare Stream couldn\'t delete the video — check the Stream token in Settings → Media, then try again.' })
    }
  } else {
    console.warn(`[video] Stream isn't configured — removing the row only; video ${asset.cloudflareStreamId} stays in Stream`)
  }

  // Delete from DB
  const assetDelete = db.delete(videoAssets).where(scopedById(videoAssets.id, id, videoAssets.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'video_assets',
    resourceId: id,
    before: { title: asset.title, cloudflareStreamId: asset.cloudflareStreamId, ...(!account && { orphanedOn: 'stream' }) },
  })
  await batchWithAudit(db, [assetDelete], auditInsert)

  return noContent(event)
})
