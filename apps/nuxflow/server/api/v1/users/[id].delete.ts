import { useDb } from '../../../utils/db'
import { userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!
  const targetId = getRouterParam(event, 'id')!

  if (targetId === userId) {
    throw createError({ statusCode: 400, message: 'You cannot remove yourself' })
  }

  const db = useDb(event)

  const existing = await db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, targetId), eq(userSiteRoles.siteId, siteId)),
  })

  if (!existing) {
    throw createError({ statusCode: 404, message: 'User not found in this site' })
  }

  if (existing.role === 'super_admin') {
    throw createError({ statusCode: 403, message: 'Cannot remove a super admin' })
  }

  await db
    .delete(userSiteRoles)
    .where(and(eq(userSiteRoles.userId, targetId), eq(userSiteRoles.siteId, siteId)))

  void writeAuditLog(event, userId, {
    action: 'delete',
    resource: 'user',
    resourceId: targetId,
    before: { role: existing.role },
  })

  return { success: true }
})
