import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getMenuByIdOrThrow } from '../../../utils/resource-queries'
import { menus } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { purgeEdgeCache, purgeAllPublicPages } from '../../../utils/edge-cache'
import { waitUntil } from '../../../utils/cf-env'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const existing = await getMenuByIdOrThrow(db, siteId, id)

  const menuDelete = db.delete(menus).where(scopedById(menus.id, id, menus.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'menu',
    resourceId: id,
    before: existing,
  })

  await batchWithAudit(db, [menuDelete], auditInsert)

  if (existing.location) {
    await purgeEdgeCache(event, [`/api/public/menus/${existing.location}`])
    if (existing.location === 'header' || existing.location === 'footer') {
      waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
        console.error('[menus] Failed to purge page cache after menu delete:', err)
      }))
    }
  }

  return noContent(event)
})
