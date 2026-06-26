import { requireRole } from '../../../../utils/permissions'
import { resolveSetting } from '../../../../utils/settings'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = event.context.siteId as string

  const accountId = await resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const streamToken = await resolveSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')

  if (!accountId || !streamToken) {
    throw createError({
      statusCode: 501,
      message: 'Cloudflare Stream is not configured. Add your Account ID and Stream API token in Settings → Media.',
    })
  }

  const body = await readBody(event)
  const title = (body?.title as string | undefined) || 'Untitled Video'

  // direct_upload returns a pre-authorised upload.cloudflarestream.com URL that supports
  // browser cross-origin POST (FormData). The authenticated TUS endpoint returns URLs
  // on edge-production.gateway.api.cloudflare.com which has no CORS headers, so TUS
  // from the browser is not possible. A plain XHR POST to the direct_upload URL is the
  // correct approach for browser-initiated uploads.
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/direct_upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${streamToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maxDurationSeconds: 14400,
          meta: { name: title, siteId, uploadedBy: userId },
        }),
      },
    )

    interface CloudflareDirectUploadResponse {
      success: boolean
      errors?: Array<{ code: number; message: string }>
      result: { uploadURL: string; uid: string }
    }

    const data = (await response.json()) as CloudflareDirectUploadResponse

    if (!response.ok || !data.success) {
      const cfError = data.errors?.[0]
      console.error('Cloudflare Stream direct_upload error:', JSON.stringify(data))

      if (cfError?.code === 10011) {
        throw createError({
          statusCode: 402,
          message: 'Your Cloudflare account has no Stream minutes allocated. Purchase a Stream minutes package in the Cloudflare dashboard (Stream → Buy minutes) to enable video uploads. The Workers Paid plan does not include Stream storage.',
        })
      }

      throw createError({
        statusCode: 502,
        message: cfError?.message || 'Failed to request upload token from Cloudflare Stream.',
      })
    }

    return { uploadUrl: data.result.uploadURL, uid: data.result.uid }
  }
  catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    console.error('Fetch error calling Cloudflare Stream API:', error)
    throw createError({ statusCode: 500, message: 'Failed to communicate with Cloudflare Stream API.' })
  }
})
