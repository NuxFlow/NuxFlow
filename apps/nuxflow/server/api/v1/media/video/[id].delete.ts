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

  // Delete from Cloudflare Stream if configured
  const accountId = await resolveStringSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const streamToken = await resolveStringSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')

  if (accountId && streamToken) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${asset.cloudflareStreamId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${streamToken}` },
        }
      )
      if (!response.ok) {
        console.error('Failed to delete video from Cloudflare Stream:', await response.text())
      }
    } catch (err) {
      console.error('Error deleting stream video from Cloudflare:', err)
    }
  }

  // Delete from DB
  const assetDelete = db.delete(videoAssets).where(scopedById(videoAssets.id, id, videoAssets.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'video_assets',
    resourceId: id,
    before: { title: asset.title, cloudflareStreamId: asset.cloudflareStreamId },
  })
  await batchWithAudit(db, [assetDelete], auditInsert)

  return noContent(event)
})
