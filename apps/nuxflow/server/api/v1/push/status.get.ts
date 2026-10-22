import { z } from 'zod'
import { requireSiteUser } from '../../../utils/permissions'
import { useDb } from '../../../utils/db'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { and, eq, count } from 'drizzle-orm'
import { requireSiteId } from '../../../utils/site-context'

const querySchema = z.object({
  // The asking browser's own subscription endpoint. With it, the answer is about this
  // browser — subscribing on a phone used to make every other browser show "subscribed"
  // too. Without it (no subscription in this browser), "any browser" is still reported.
  endpoint: z.string().url().max(2048).optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireSiteUser(event)
  const siteId = requireSiteId(event)
  const { endpoint } = await parseQuery(event, querySchema)
  const db = useDb(event)

  const [row] = await db
    .select({ n: count() })
    .from(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.siteId, siteId),
      endpoint ? eq(pushSubscriptions.endpoint, endpoint) : undefined,
    ))

  return { subscribed: (row?.n ?? 0) > 0 }
})
