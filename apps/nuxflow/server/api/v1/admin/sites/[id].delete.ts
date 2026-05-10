import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)
  const id = getRouterParam(event, 'id')!
  await db.delete(sites).where(eq(sites.id, id))
  return { id }
})
