import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { resolveStringSetting } from '../../../../utils/settings'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getVideoAssetByIdOrThrow } from '../../../../utils/resource-queries'
import { videoAssets } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { requireSiteId } from '../../../../utils/site-context'

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
  const accountId = await resolveStringSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const streamToken = await resolveStringSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')
  const reachable = Boolean(accountId && streamToken)

  if (reachable) {
    let response: Response
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${asset.cloudflareStreamId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${streamToken}` },
        }
      )
    } catch (err) {
      console.error('[video] Cloudflare Stream delete request failed:', err)
      throw createError({ statusCode: 502, message: "Couldn't reach Cloudflare Stream to delete the video. Try again in a moment." })
    }
    if (!response.ok && response.status !== 404) {
      console.error('[video] Cloudflare Stream delete failed:', response.status, await response.text())
      throw createError({ statusCode: 502, message: `Cloudflare Stream refused to delete the video (HTTP ${response.status}) — check the Stream token in Settings → Media.` })
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
    before: { title: asset.title, cloudflareStreamId: asset.cloudflareStreamId, ...(!reachable && { orphanedOn: 'stream' }) },
  })
  await batchWithAudit(db, [assetDelete], auditInsert)

  return noContent(event)
})
