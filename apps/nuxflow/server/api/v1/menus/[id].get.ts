import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { menus } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const menu = await db.query.menus.findFirst({
    where: and(eq(menus.id, id), eq(menus.siteId, siteId)),
  })
  if (!menu) throw createError({ statusCode: 404, message: 'Menu not found' })

  return menu
})
