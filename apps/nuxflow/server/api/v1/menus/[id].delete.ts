import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getMenuByIdOrThrow } from '../../../utils/resource-queries'
import { menus } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { purgeMenuLocations } from '../../../utils/menus'
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
  await purgeMenuLocations(event, siteId, [existing.location])

  return noContent(event)
})
