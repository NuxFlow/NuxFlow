import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { menus } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await db.query.menus.findFirst({
    where: and(eq(menus.id, id), eq(menus.siteId, siteId)),
  })

  await db.delete(menus).where(and(eq(menus.id, id), eq(menus.siteId, siteId)))

  await writeAuditLog(event, userId, {
    action: 'delete',
    resource: 'menu',
    resourceId: id,
    before: existing,
  })

  return { ok: true }
})
