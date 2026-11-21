import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { menus } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { MENU_LOCATIONS, purgeMenuLocations } from '../../../utils/menus'
import { requireSiteId } from '../../../utils/site-context'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  location: z.enum(MENU_LOCATIONS).nullish(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const body = await parseBody(event, bodySchema)

  const id = ulid()
  const menuInsert = db.insert(menus).values({ id, siteId, name: body.name, location: body.location ?? null, items: [] })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'menu',
    resourceId: id,
    after: { name: body.name, location: body.location ?? null },
  })

  await batchWithAudit(db, [menuInsert], auditInsert)
  await purgeMenuLocations(event, siteId, [body.location])

  return { id }
})
