import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getVideoAssetByIdOrThrow } from '../../../../utils/resource-queries'
import { videoAssets } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { requireSiteId } from '../../../../utils/site-context'
import { getStreamVideo, streamAccountFor, withAdminPlayback } from '../../../../utils/stream'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'viewer')
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  let asset = await getVideoAssetByIdOrThrow(db, siteId, id)
  setHeader(event, 'Cache-Control', 'private, no-store')

  // If the video is still processing/uploading, sync status with Cloudflare Stream
  if (asset.status === 'processing' || asset.status === 'uploading') {
    const account = await streamAccountFor(event, asset.streamAccount)
    if (account) {
      try {
        const res = await getStreamVideo(account, asset.cloudflareStreamId)
        if (res) {
          const cfState = res.status?.state
          const duration = res.duration && res.duration > 0 ? Math.round(res.duration) : null
          const thumbnailUrl = res.thumbnail || null
          let newStatus: 'ready' | 'processing' | 'failed' | 'uploading' = asset.status

          if (cfState === 'ready') {
            newStatus = 'ready'
          } else if (cfState === 'error') {
            newStatus = 'failed'
          }

          // If metadata has changed, write back to DB
          if (newStatus !== asset.status || duration !== asset.duration || thumbnailUrl !== asset.thumbnailUrl) {
            const update = {
              status: newStatus,
              duration: duration ?? asset.duration,
              thumbnailUrl: thumbnailUrl ?? asset.thumbnailUrl,
            }
            await db.update(videoAssets)
              .set(update)
              .where(scopedById(videoAssets.id, id, videoAssets.siteId, siteId))
            asset = { ...asset, ...update }
          }
        }
      } catch (err) {
        console.error('Error syncing stream details:', err)
      }
    }
  }

  return withAdminPlayback(event, siteId, asset)
})
