import { useDb } from '../../../utils/db'
import { userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole, getUserSiteRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!
  const targetId = getRouterParam(event, 'id')!

  if (targetId === userId) {
    throw badRequest('You cannot remove yourself')
  }

  const db = useDb(event)

  const existing = await getUserSiteRole(db, targetId, siteId)

  if (!existing) {
    throw notFound('User not found in this site')
  }

  if (existing.role === 'super_admin') {
    throw forbidden('Cannot remove a super admin')
  }

  const roleDelete = db
    .delete(userSiteRoles)
    .where(and(eq(userSiteRoles.userId, targetId), eq(userSiteRoles.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'user',
    resourceId: targetId,
    before: { role: existing.role },
  })
  await batchWithAudit(db, [roleDelete], auditInsert)

  return noContent(event)
})
