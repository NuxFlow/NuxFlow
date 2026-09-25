import { useDb } from '../../../../utils/db'
import { users, userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { requireSuperAdmin, getUserSiteRole } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { clearCachedRole } from '../../../../utils/role-cache'
import { alertRoleChanged } from '../../../../utils/security-alerts'

// Grants super_admin on the CURRENT site for the target user. hasSuperAdminRole()
// treats "a super_admin row on ANY site" as platform-wide super admin status, so this
// is the whole mechanism — there's no separate global flag to set. Deliberately its own
// endpoint rather than a branch of PATCH /api/v1/users/:id: that route is usable by any
// site 'admin' and explicitly blocks the super_admin role value, since granting it is
// meaningfully more sensitive than a normal role change and previously had no path at
// all outside the setup wizard (which also reseeds the site's content — too heavy a
// side effect just to promote someone).
export default defineEventHandler(async (event) => {
  const { userId } = await requireSuperAdmin(event)
  const siteId = event.context.siteId!
  const targetId = getRouterParam(event, 'id')!

  const db = useDb(event)

  const target = await db.query.users.findFirst({ where: eq(users.id, targetId), columns: { id: true } })
  if (!target) throw notFound('User not found')

  const existing = await getUserSiteRole(db, targetId, siteId)

  if (existing?.role === 'super_admin') {
    return { success: true, alreadySuperAdmin: true }
  }

  const write = existing
    ? db.update(userSiteRoles).set({ role: 'super_admin' })
      .where(and(eq(userSiteRoles.userId, targetId), eq(userSiteRoles.siteId, siteId)))
    : db.insert(userSiteRoles).values({ id: ulid(), userId: targetId, siteId, role: 'super_admin' })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'grant_super_admin',
    resource: 'user',
    resourceId: targetId,
    before: existing ? { role: existing.role } : undefined,
    after: { role: 'super_admin' },
  })
  await batchWithAudit(db, [write], auditInsert)
  clearCachedRole(targetId, siteId)
  alertRoleChanged(event, targetId, existing?.role, 'super_admin')

  return { success: true, alreadySuperAdmin: false }
})
