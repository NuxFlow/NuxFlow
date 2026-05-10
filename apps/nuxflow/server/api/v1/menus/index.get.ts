import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { menus } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const rows = await db.query.menus.findMany({
    where: eq(menus.siteId, siteId),
    columns: { id: true, name: true, location: true, items: true, updatedAt: true },
  })

  return { menus: rows }
})
