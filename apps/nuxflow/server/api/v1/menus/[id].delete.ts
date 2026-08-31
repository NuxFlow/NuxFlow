import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getMenuByIdOrThrow } from '../../../utils/resource-queries'
import { menus } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { purgeEdgeCache } from '../../../utils/edge-cache'

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
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

  if (existing.location) await purgeEdgeCache(event, [`/api/public/menus/${existing.location}`])

  return noContent(event)
})
