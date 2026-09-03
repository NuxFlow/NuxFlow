import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { resolveSetting } from '../../../../utils/settings'
import { videoAssets } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { created } from '../../../../utils/response'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = event.context.siteId as string

  const body = await readBody(event)
  const uid = body?.uid as string | undefined
  let title = body?.title as string | undefined
  const size = body?.size as number | undefined

  if (!uid) {
    throw badRequest('Missing video UID (cloudflareStreamId)')
  }

  const accountId = await resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const streamToken = await resolveSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')

  if (!accountId || !streamToken) {
    throw createError({
      statusCode: 501,
      message: 'Cloudflare Stream is not configured. Add your Account ID and Stream API token in Settings → Media.',
    })
  }

  // The `uid` is client-supplied and never verified against what token.post.ts actually
  // issued. Requiring this lookup to succeed before inserting anything is the whole
  // fix here: previously any failure (bad uid, network error, non-2xx) fell through
  // silently and still inserted a video_assets row stuck at status:'processing'
  // forever, since nothing ever revisits it. Fail the request instead.
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

  let response: Response
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
      {
        headers: { Authorization: `Bearer ${streamToken}` },
      }
    )
  } catch (err) {
    console.error('Error fetching stream details during registration:', err)
    throw createError({ statusCode: 502, message: 'Failed to communicate with Cloudflare Stream API while verifying the upload.' })
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    console.error('Cloudflare Stream lookup HTTP error during registration:', response.status, errText)
    throw createError({
      statusCode: response.status === 404 ? 404 : 502,
      message: 'Cloudflare Stream did not recognize this upload UID. It may not have finished uploading yet, or belongs to a different account.',
    })
  }

  const data = (await response.json()) as CloudflareStreamDetailsResponse
  if (!data.success || !data.result) {
    console.error('Cloudflare Stream lookup returned an unsuccessful response during registration:', JSON.stringify(data))
    throw createError({ statusCode: 502, message: 'Cloudflare Stream returned an unexpected response while verifying the upload.' })
  }

  const res = data.result
  if (!title && res.meta?.name) title = res.meta.name
  const duration = res.duration ? Math.round(res.duration) : null
  const thumbnailUrl = res.thumbnail || null

  const cfState = res.status?.state
  const status: 'uploading' | 'processing' | 'ready' | 'failed'
    = cfState === 'ready' ? 'ready' : cfState === 'error' ? 'failed' : 'processing'

  const finalTitle = title || 'Untitled Video'
  const fileId = ulid()

  const db = useDb(event)
  const assetInsert = db.insert(videoAssets).values({
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

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'video_assets',
    resourceId: fileId,
    after: { title: finalTitle, cloudflareStreamId: uid },
  })
  await batchWithAudit(db, [assetInsert], auditInsert)

  return created(event, {
    id: fileId,
    title: finalTitle,
    cloudflareStreamId: uid,
    status,
  })
})
