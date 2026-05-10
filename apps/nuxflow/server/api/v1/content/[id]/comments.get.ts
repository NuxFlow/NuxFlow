import { useDb } from '../../../../utils/db'
import { comments } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  const siteId = event.context.siteId!
  const itemId = getRouterParam(event, 'id')!

  const db = useDb(event)

  const rows = await db.query.comments.findMany({
    where: and(
      eq(comments.itemId, itemId),
      eq(comments.siteId, siteId),
      session ? undefined : eq(comments.status, 'approved'),
    ),
    orderBy: [desc(comments.createdAt)],
  })

  return { comments: rows }
})
