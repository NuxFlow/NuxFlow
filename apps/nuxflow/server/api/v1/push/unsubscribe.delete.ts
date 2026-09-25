import { z } from 'zod'
import { requireAuth } from '../../../utils/permissions'
import { useDb } from '../../../utils/db'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  endpoint: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)
  const db = useDb(event)

  // Site-scoped: subscribe.post.ts stores one row per site for the same browser endpoint,
  // so turning notifications off on this site must not remove them on the user's others.
  await db.delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.siteId, siteId),
      eq(pushSubscriptions.endpoint, body.endpoint),
    ))

  return noContent(event)
})
