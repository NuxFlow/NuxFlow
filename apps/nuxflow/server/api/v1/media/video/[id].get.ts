import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { resolveSetting } from '../../../../utils/settings'
import { videoAssets } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'viewer')
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  const asset = await db.query.videoAssets.findFirst({
    where: and(eq(videoAssets.id, id), eq(videoAssets.siteId, siteId)),
  })

  if (!asset) {
    throw createError({ statusCode: 404, message: 'Video asset not found' })
  }

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
                .where(eq(videoAssets.id, id))

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
