import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getMenuByIdOrThrow } from '../../../utils/resource-queries'
import { menus } from '@nuxflow/db/schema'
import { sql } from 'drizzle-orm'
import { scopedById } from '../../../utils/db-helpers'
import { MENU_LOCATIONS, menuItemsSchema, purgeMenuLocations } from '../../../utils/menus'
import { requireSiteId } from '../../../utils/site-context'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  location: z.enum(MENU_LOCATIONS).nullish(),
  items: menuItemsSchema.optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await getMenuByIdOrThrow(db, siteId, id)

  const menuUpdate = db.update(menus)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...('location' in body && { location: body.location ?? null }),
      ...(body.items !== undefined && { items: body.items as unknown[] }),
      updatedAt: sql`(datetime('now'))`,
    })
    .where(scopedById(menus.id, id, menus.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'menu',
    resourceId: id,
    before: existing,
    after: body,
  })

  await batchWithAudit(db, [menuUpdate], auditInsert)

  // Both the old and the new location: covers a move as well as an in-place items edit.
  const newLocation = 'location' in body ? (body.location ?? null) : existing.location
  await purgeMenuLocations(event, siteId, [existing.location, newLocation])

  return { ok: true }
})
