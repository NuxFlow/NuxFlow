import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { notifications } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const items = await db.query.notifications.findMany({
    where: and(eq(notifications.userId, userId), eq(notifications.siteId, siteId)),
    orderBy: [desc(notifications.createdAt)],
    limit: 30,
  })

  return { notifications: items }
})
