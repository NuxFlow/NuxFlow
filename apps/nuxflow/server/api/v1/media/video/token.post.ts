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
  const title = body?.title || 'Untitled Video'

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
          meta: {
            name: title,
            siteId,
            uploadedBy: userId,
          },
        }),
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      console.error('Cloudflare Stream direct upload error:', errText)
      throw createError({
        statusCode: 502,
        message: 'Failed to request upload token from Cloudflare Stream.',
      })
    }

    interface CloudflareDirectUploadResponse {
      success: boolean
      errors?: Array<{ message: string }>
      result: {
        uploadURL: string
        uid: string
      }
    }

    const data = (await response.json()) as CloudflareDirectUploadResponse
    if (!data.success) {
      throw createError({
        statusCode: 502,
        message: data.errors?.[0]?.message || 'Cloudflare Stream API error.',
      })
    }

    return {
      uploadUrl: data.result.uploadURL,
      uid: data.result.uid,
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    console.error('Fetch error calling Cloudflare Stream API:', error)
    throw createError({
      statusCode: 500,
      message: 'Failed to communicate with Cloudflare Stream API.',
    })
  }
})
