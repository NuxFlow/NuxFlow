import { useDb } from '../../../utils/db'
import { getUserSiteRole, hasSuperAdminRole } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string | null

  const [siteRole, hasAnySuperAdminGrant] = await Promise.all([
    siteId ? getUserSiteRole(db, session.user.id, siteId) : Promise.resolve(null),
    hasSuperAdminRole(db, session.user.id),
  ])
  // Matches requireSuperAdmin(): platform actions are only accepted on a site where the
  // caller holds super_admin, so the super-admin UI is only shown there too.
  const isSuperAdmin = siteRole?.role === 'super_admin'

  // Mirrors requireAuth()'s access model (see permissions.ts): a real per-site role
  // wins, a super admin still reports a baseline 'viewer' with no local row (matches
  // their documented cross-site access), and anyone else genuinely has no access to
  // this site — reported as null rather than a fabricated 'viewer' that would
  // overstate what they can actually do.
  return {
    role: siteRole?.role ?? (hasAnySuperAdminGrant ? 'viewer' : null),
    isSuperAdmin,
  }
})
