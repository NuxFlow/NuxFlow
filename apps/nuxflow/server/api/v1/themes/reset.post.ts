import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { clearActiveThemeCache } from '../../../utils/theme-cache'
import { themes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const deactivateAll = db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'reset', resource: 'theme', resourceId: 'default' })

  await db.batch(auditInsert ? [deactivateAll, auditInsert] : [deactivateAll])
  clearActiveThemeCache(siteId)
  return { success: true }
})
