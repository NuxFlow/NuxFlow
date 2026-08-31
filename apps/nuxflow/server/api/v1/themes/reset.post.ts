import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { clearActiveThemeCache } from '../../../utils/theme-cache'
import { themes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const deactivateAll = db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'reset', resource: 'theme', resourceId: 'default' })

  await batchWithAudit(db, [deactivateAll], auditInsert)
  clearActiveThemeCache(siteId)
  return { success: true }
})
