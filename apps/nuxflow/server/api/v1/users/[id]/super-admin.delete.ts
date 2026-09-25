import { useDb } from '../../../../utils/db'
import { userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireSuperAdmin, getUserSiteRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { clearCachedRole } from '../../../../utils/role-cache'
import { alertRoleChanged } from '../../../../utils/security-alerts'

// Revokes super_admin on the CURRENT site for the target user, downgrading them to
// 'admin' rather than deleting their access to the site outright — this is a demotion,
// not a removal (use DELETE /api/v1/users/:id for that). Only strips super_admin status
// platform-wide if this was their only super_admin row; if they hold one on another site
// too, hasSuperAdminRole() still finds that one and they remain a super admin there,
// which is correct — each site's grant is independent, same as PATCH/[id].delete.ts
// already treat every other role.
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const siteId = event.context.siteId!
  const targetId = getRouterParam(event, 'id')!

  if (targetId === userId) {
    throw badRequest('You cannot revoke your own super admin status — ask another super admin to do it')
  }

  const db = useDb(event)
  const existing = await getUserSiteRole(db, targetId, siteId)

  if (!existing || existing.role !== 'super_admin') {
    throw notFound('This user is not a super admin on this site')
  }

  const roleUpdate = db.update(userSiteRoles).set({ role: 'admin' })
    .where(and(eq(userSiteRoles.userId, targetId), eq(userSiteRoles.siteId, siteId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'revoke_super_admin',
    resource: 'user',
    resourceId: targetId,
    before: { role: 'super_admin' },
    after: { role: 'admin' },
  })
  await batchWithAudit(db, [roleUpdate], auditInsert)
  clearCachedRole(targetId, siteId)
  alertRoleChanged(event, targetId, 'super_admin', 'admin')

  return { success: true }
})
