import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { resolveSetting } from '../../../../utils/settings'
import { buildAuditLogInsert } from '../../../../utils/audit'
import { getVideoAssetByIdOrThrow } from '../../../../utils/resource-queries'
import { videoAssets } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  const asset = await getVideoAssetByIdOrThrow(db, siteId, id)

  // Delete from Cloudflare Stream if configured
  const accountId = await resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const streamToken = await resolveSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken')

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
  const assetDelete = db.delete(videoAssets).where(and(eq(videoAssets.id, id), eq(videoAssets.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'video_assets',
    resourceId: id,
    before: { title: asset.title, cloudflareStreamId: asset.cloudflareStreamId },
  })
  await db.batch(auditInsert ? [assetDelete, auditInsert] : [assetDelete])

  return noContent(event)
})
