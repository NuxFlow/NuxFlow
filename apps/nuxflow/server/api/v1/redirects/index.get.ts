import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { redirects } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const items = await db.query.redirects.findMany({
    where: eq(redirects.siteId, siteId),
    orderBy: [desc(redirects.createdAt)],
  })
  return { redirects: items }
})
