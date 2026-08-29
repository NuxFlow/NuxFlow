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

  // Navigation changes only via the admin menu editor, so this is safe to
  // cache at the edge like the other mostly-static public chrome endpoints.
  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')

  return menu ?? null
})
