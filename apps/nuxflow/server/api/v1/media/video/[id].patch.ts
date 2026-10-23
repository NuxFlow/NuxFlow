import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getVideoAssetByIdOrThrow } from '../../../../utils/resource-queries'
import { videoAssets } from '@nuxflow/db/schema'
import { scopedById } from '../../../../utils/db-helpers'
import { parseBody } from '../../../../utils/validate'
import { z } from 'zod'
import { requireSiteId } from '../../../../utils/site-context'
import { bumpCacheVersion } from '../../../../utils/cache-version'
import { setStreamVideoPrivate, streamAccountFor, streamNotConfigured } from '../../../../utils/stream'

const bodySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500).optional(),
  // Private = plays only through a signed link on the site's own pages (utils/stream.ts).
  isPrivate: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb(event)

  const asset = await getVideoAssetByIdOrThrow(db, siteId, id)

  const { title, isPrivate } = await parseBody(event, bodySchema)
  const privacyChanged = isPrivate !== undefined && isPrivate !== asset.isPrivate

  // Stream first: the row only says private once Stream really requires signed links.
  if (privacyChanged) {
    const account = await streamAccountFor(event, asset.streamAccount)
    if (!account) streamNotConfigured()
    // A video paused by the plan's watching allowance keeps needing signed links.
    await setStreamVideoPrivate(account, asset.cloudflareStreamId, isPrivate || asset.watchPaused)
  }

  const set = {
    ...(title !== undefined && { title }),
    ...(privacyChanged && { isPrivate }),
  }
  if (Object.keys(set).length === 0) return { success: true }

  const assetUpdate = db.update(videoAssets)
    .set(set)
    .where(scopedById(videoAssets.id, id, videoAssets.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'video_assets',
    resourceId: id,
    before: { title: asset.title, isPrivate: asset.isPrivate },
    after: set,
  })
  await batchWithAudit(db, [assetUpdate], auditInsert)

  // Cached public pages carry each Stream video's privacy (markPrivateVideos).
  if (privacyChanged) await bumpCacheVersion(event, siteId).catch(() => {})

  return { success: true }
})
