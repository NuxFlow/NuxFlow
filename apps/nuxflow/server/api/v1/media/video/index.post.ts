import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { resolveSetting } from '../../../../utils/settings'
import { videoAssets } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { writeAuditLog } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = event.context.siteId as string

  const body = await readBody(event)
  const uid = body?.uid as string | undefined
  let title = body?.title as string | undefined
  const size = body?.size as number | undefined

  if (!uid) {
    throw createError({
      statusCode: 400,
      message: 'Missing video UID (cloudflareStreamId)',
    })
  }

  const accountId = await resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const streamToken = await resolveSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')

  let duration: number | null = null
  let thumbnailUrl: string | null = null
  let status: 'uploading' | 'processing' | 'ready' | 'failed' = 'processing'

  if (accountId && streamToken) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
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
          if (!title && res.meta?.name) title = res.meta.name
          duration = res.duration ? Math.round(res.duration) : null
          thumbnailUrl = res.thumbnail || null

          const cfState = res.status?.state
          if (cfState === 'ready') {
            status = 'ready'
          } else if (cfState === 'error') {
            status = 'failed'
          } else {
            status = 'processing'
          }
        }
      }
    } catch (err) {
      console.error('Error fetching stream details during registration:', err)
    }
  }

  const finalTitle = title || 'Untitled Video'
  const fileId = ulid()

  const db = useDb(event)
  await db.insert(videoAssets).values({
    id: fileId,
    siteId,
    uploadedBy: userId,
    cloudflareStreamId: uid,
    title: finalTitle,
    duration,
    thumbnailUrl,
    status,
    size: size || null,
  })

  void writeAuditLog(event, userId, {
    action: 'create',
    resource: 'video_assets',
    resourceId: fileId,
    after: { title: finalTitle, cloudflareStreamId: uid },
  })

  setResponseStatus(event, 201)
  return {
    id: fileId,
    title: finalTitle,
    cloudflareStreamId: uid,
    status,
  }
})
