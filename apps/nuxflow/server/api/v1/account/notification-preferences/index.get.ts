import { and, eq } from 'drizzle-orm'
import { notificationPreferences } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireAuth, roleAtLeast } from '../../../../utils/permissions'
import { NOTIFICATION_TYPES } from '../../../../utils/notify'

/** The caller's delivery preferences on this site, one entry per type relevant to their role. */
export default defineEventHandler(async (event) => {
  const { userId, role } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const rows = await db.query.notificationPreferences.findMany({
    where: and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.siteId, siteId)),
  })
  const saved = new Map(rows.map(r => [r.type, r]))

  return {
    preferences: Object.entries(NOTIFICATION_TYPES)
      .filter(([, def]) => !def.minRole || roleAtLeast(role, def.minRole))
      .map(([type, def]) => ({
        type,
        label: def.label,
        description: def.description,
        email: def.mandatoryEmail ? true : (saved.get(type)?.email ?? def.email),
        push: saved.get(type)?.push ?? def.push,
        emailLocked: !!def.mandatoryEmail,
      })),
  }
})
