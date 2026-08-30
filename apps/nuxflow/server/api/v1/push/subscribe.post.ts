import { z } from 'zod'
import { requireAuth } from '../../../utils/permissions'
import { useDb } from '../../../utils/db'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { created } from '../../../utils/response'

const bodySchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)
  const db = useDb(event)

  // Upsert: replace any existing subscription for this user+endpoint pair
  const existing = await db.query.pushSubscriptions.findFirst({
    where: and(
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.endpoint, body.endpoint),
    ),
    columns: { id: true },
  })

  if (existing) {
    await db.update(pushSubscriptions)
      .set({ p256dh: body.p256dh, auth: body.auth })
      .where(eq(pushSubscriptions.id, existing.id))
  } else {
    await db.insert(pushSubscriptions).values({
      id: ulid(),
      siteId,
      userId,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
    })
  }

  return created(event, { subscribed: true })
})
