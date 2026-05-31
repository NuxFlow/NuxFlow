import { useDb } from '../../../utils/db'
import { menus } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404 })

  const db = useDb(event)
  const location = getRouterParam(event, 'location')!

  const menu = await db.query.menus.findFirst({
    where: and(eq(menus.siteId, siteId), eq(menus.location, location)),
    columns: { id: true, name: true, items: true },
  })

  return menu ?? null
})
