import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { themes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  await db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))

  await writeAuditLog(event, userId, { action: 'reset', resource: 'theme', resourceId: 'default' })
  return { success: true }
})
