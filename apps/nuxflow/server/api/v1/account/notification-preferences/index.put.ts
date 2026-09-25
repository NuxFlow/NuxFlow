import { z } from 'zod'
import { ulid } from 'ulid'
import { sql } from 'drizzle-orm'
import { notificationPreferences } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { parseBody } from '../../../../utils/validate'
import { NOTIFICATION_TYPES } from '../../../../utils/notify'

const bodySchema = z.object({
  preferences: z.array(z.object({
    type: z.string().max(100),
    email: z.boolean(),
    push: z.boolean(),
  })).max(50),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const writes = body.preferences
    .filter(p => p.type in NOTIFICATION_TYPES)
    .map(p => db.insert(notificationPreferences).values({
      id: ulid(),
      siteId,
      userId,
      type: p.type,
      // Stored as sent, but ignored for mandatoryEmail types at delivery time (notify.ts).
      email: p.email,
      push: p.push,
    }).onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.siteId, notificationPreferences.type],
      set: { email: p.email, push: p.push, updatedAt: sql`(datetime('now'))` },
    }))

  if (writes.length) await db.batch(writes as [typeof writes[number], ...typeof writes])
  return { success: true }
})
