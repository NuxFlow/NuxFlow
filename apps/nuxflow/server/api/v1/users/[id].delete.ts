import { useDb } from '../../../utils/db'
import { userSiteRoles, siteInvitations } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole, getUserSiteRole, assertNotSelfTarget, assertTargetNotSuperAdmin } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { clearCachedRole } from '../../../utils/role-cache'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!
  const targetId = getRouterParam(event, 'id')!

  assertNotSelfTarget(targetId, userId, 'You cannot remove yourself')

  const db = useDb(event)

  const existing = await getUserSiteRole(db, targetId, siteId)

  if (!existing) {
    // Not a member yet — may still be a pending invitation (see site_invitations), which
    // "Remove" withdraws.
    const invitation = await db.query.siteInvitations.findFirst({
      where: and(eq(siteInvitations.userId, targetId), eq(siteInvitations.siteId, siteId)),
      columns: { role: true },
    })
    if (!invitation) throw notFound('User not found in this site')
    await batchWithAudit(db, [
      db.delete(siteInvitations).where(and(eq(siteInvitations.userId, targetId), eq(siteInvitations.siteId, siteId))),
    ], buildAuditLogInsert(event, userId, {
      action: 'delete',
      resource: 'user_invitation',
      resourceId: targetId,
      before: { role: invitation.role },
    }))
    return noContent(event)
  }

  assertTargetNotSuperAdmin(existing.role, 'Cannot remove a super admin')

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
  clearCachedRole(targetId, siteId)

  return noContent(event)
})
