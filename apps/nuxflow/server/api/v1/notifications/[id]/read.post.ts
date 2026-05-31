import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { notifications } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const id = getRouterParam(event, 'id')!

  await db.update(notifications)
    .set({ readAt: sql`(datetime('now'))` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))

  return { success: true }
})
