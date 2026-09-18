import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { notifications } from '@nuxflow/db/schema'
import { and, eq, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  // userId alone isn't enough scoping here — user accounts are global across this
  // multi-tenant install, so a user who belongs to Site A and Site B could otherwise mark a
  // Site A notification read via a request made against Site B's domain, since ULIDs are
  // guessable/enumerable by design (monotonic, time-based). The list route already scopes
  // by both; this route needs to match it.
  await db.update(notifications)
    .set({ readAt: sql`(datetime('now'))` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), eq(notifications.siteId, siteId)))

  return { success: true }
})
