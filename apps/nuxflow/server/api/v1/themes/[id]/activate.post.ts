import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { buildAuditLogInsert } from '../../../../utils/audit'
import { clearActiveThemeCache } from '../../../../utils/theme-cache'
import { getThemeByIdOrThrow } from '../../../../utils/resource-queries'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await getThemeByIdOrThrow(db, siteId, id)

  // Deactivate all, activate target
  const deactivateAll = db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))
  const activateTarget = db.update(themes).set({ isActive: true }).where(and(eq(themes.id, id), eq(themes.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'activate', resource: 'theme', resourceId: id })

  await db.batch(auditInsert ? [deactivateAll, activateTarget, auditInsert] : [deactivateAll, activateTarget])
  clearActiveThemeCache(siteId)
  return { success: true }
})
