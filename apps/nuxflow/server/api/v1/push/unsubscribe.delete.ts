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
  const body = await parseBody(event, bodySchema)
  const db = useDb(event)

  await db.delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.endpoint, body.endpoint),
    ))

  return noContent(event)
})
