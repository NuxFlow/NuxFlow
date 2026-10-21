import { requireSiteUser } from '../../../utils/permissions'
import { useDb } from '../../../utils/db'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { and, eq, count } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireSiteUser(event)
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const [row] = await db
    .select({ n: count() })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.siteId, siteId)))

  return { subscribed: (row?.n ?? 0) > 0 }
})
