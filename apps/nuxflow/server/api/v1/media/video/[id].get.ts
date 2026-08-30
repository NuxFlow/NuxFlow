import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { resolveSetting } from '../../../../utils/settings'
import { getVideoAssetByIdOrThrow } from '../../../../utils/resource-queries'
import { videoAssets } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'viewer')
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  const asset = await getVideoAssetByIdOrThrow(db, siteId, id)

  // If the video is still processing/uploading, sync status with Cloudflare Stream
  if (asset.status === 'processing' || asset.status === 'uploading') {
    const accountId = await resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
    const streamToken = await resolveSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')

    if (accountId && streamToken) {
      try {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${asset.cloudflareStreamId}`,
          {
            headers: { Authorization: `Bearer ${streamToken}` },
          }
        )

        if (response.ok) {
          interface CloudflareStreamDetailsResponse {
            success: boolean
            result?: {
              duration?: number
              thumbnail?: string
              status?: {
                state: string
              }
              meta?: {
                name?: string
              }
            }
          }
          const data = (await response.json()) as CloudflareStreamDetailsResponse
          if (data.success && data.result) {
            const res = data.result
            const cfState = res.status?.state
            const duration = res.duration ? Math.round(res.duration) : null
            const thumbnailUrl = res.thumbnail || null
            let newStatus: 'ready' | 'processing' | 'failed' | 'uploading' = asset.status

            if (cfState === 'ready') {
              newStatus = 'ready'
            } else if (cfState === 'error') {
              newStatus = 'failed'
            }

            // If metadata has changed, write back to DB
            if (newStatus !== asset.status || duration !== asset.duration || thumbnailUrl !== asset.thumbnailUrl) {
              await db.update(videoAssets)
                .set({
                  status: newStatus,
                  duration: duration ?? asset.duration,
                  thumbnailUrl: thumbnailUrl ?? asset.thumbnailUrl,
                })
                .where(scopedById(videoAssets.id, id, videoAssets.siteId, siteId))

              // Return updated object
              return {
                ...asset,
                status: newStatus,
                duration: duration ?? asset.duration,
                thumbnailUrl: thumbnailUrl ?? asset.thumbnailUrl,
              }
            }
          }
        }
      } catch (err) {
        console.error('Error syncing stream details:', err)
      }
    }
  }

  return asset
})
