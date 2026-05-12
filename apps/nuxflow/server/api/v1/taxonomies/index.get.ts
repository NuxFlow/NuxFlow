import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { taxonomies } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const rows = await db.query.taxonomies.findMany({
    where: eq(taxonomies.siteId, siteId),
    columns: { id: true, slug: true, name: true, isHierarchical: true, createdAt: true },
  })

  return { taxonomies: rows }
})
