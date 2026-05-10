import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { writeAuditLog } from '../../../../utils/audit'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const theme = await db.query.themes.findFirst({
    where: and(eq(themes.id, id), eq(themes.siteId, siteId)),
  })
  if (!theme) throw createError({ statusCode: 404, message: 'Theme not found' })

  // Deactivate all, activate target
  await db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId))
  await db.update(themes).set({ isActive: true }).where(and(eq(themes.id, id), eq(themes.siteId, siteId)))

  await writeAuditLog(event, userId, { action: 'activate', resource: 'theme', resourceId: id })
  return { success: true }
})
