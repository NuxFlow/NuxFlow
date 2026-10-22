import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { menus } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = requireSiteId(event)

  const rows = await db.query.menus.findMany({
    where: eq(menus.siteId, siteId),
    columns: { id: true, name: true, location: true, items: true, updatedAt: true },
  })

  return { menus: rows }
})
