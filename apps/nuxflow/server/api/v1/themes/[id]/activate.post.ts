import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { clearActiveThemeCache } from '../../../../utils/theme-cache'
import { getThemeByIdOrThrow } from '../../../../utils/resource-queries'
import { themes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { scopedById } from '../../../../utils/db-helpers'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await getThemeByIdOrThrow(db, siteId, id)

  // Deactivate all, activate target
  const deactivateAll = db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))
  const activateTarget = db.update(themes).set({ isActive: true }).where(scopedById(themes.id, id, themes.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'activate', resource: 'theme', resourceId: id })

  await batchWithAudit(db, [deactivateAll, activateTarget], auditInsert)
  clearActiveThemeCache(siteId)
  return { success: true }
})
