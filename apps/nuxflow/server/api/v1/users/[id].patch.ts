import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { userSiteRoles, siteInvitations } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole, getUserSiteRole, assertNotSelfTarget, assertTargetNotSuperAdmin } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { clearCachedRole } from '../../../utils/role-cache'
import { alertRoleChanged } from '../../../utils/security-alerts'

const bodySchema = z.object({
  role: z.enum(['admin', 'editor', 'author', 'viewer', 'member']).optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!
  const targetId = getRouterParam(event, 'id')!

  const body = await parseBody(event, bodySchema)
  const db = useDb(event)

  if (body.role) {
    assertNotSelfTarget(targetId, userId, 'You cannot change your own role')

    const existing = await getUserSiteRole(db, targetId, siteId)

    if (!existing) {
      // Not a member — possibly a pending invitation, whose offered role can be changed
      // before it's accepted. Anyone else isn't this site's to modify (and must not get a
      // "your role changed" security alert from a site they don't belong to).
      const invitation = await db.query.siteInvitations.findFirst({
        where: and(eq(siteInvitations.userId, targetId), eq(siteInvitations.siteId, siteId)),
        columns: { role: true },
      })
      if (!invitation) throw notFound('User not found in this site')
      await batchWithAudit(db, [
        db.update(siteInvitations).set({ role: body.role })
          .where(and(eq(siteInvitations.userId, targetId), eq(siteInvitations.siteId, siteId))),
      ], buildAuditLogInsert(event, userId, {
        action: 'update',
        resource: 'user_invitation',
        resourceId: targetId,
        before: { role: invitation.role },
        after: { role: body.role },
      }))
      return { success: true }
    }

    assertTargetNotSuperAdmin(existing.role, 'Cannot modify a super admin\'s role')

    const roleUpdate = db
      .update(userSiteRoles)
      .set({ role: body.role })
      .where(and(eq(userSiteRoles.userId, targetId), eq(userSiteRoles.siteId, siteId)))

    const auditInsert = buildAuditLogInsert(event, userId, {
      action: 'update',
      resource: 'user',
      resourceId: targetId,
      before: { role: existing.role },
      after: { role: body.role },
    })
    await batchWithAudit(db, [roleUpdate], auditInsert)
    clearCachedRole(targetId, siteId)
    if (existing.role !== body.role) alertRoleChanged(event, targetId, existing.role, body.role)
  }

  return { success: true }
})
