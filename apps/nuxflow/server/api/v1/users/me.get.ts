import { useDb } from '../../../utils/db'
import { getUserSiteRole, hasSuperAdminRole } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string | null

  const [siteRole, isSuperAdmin] = await Promise.all([
    siteId ? getUserSiteRole(db, session.user.id, siteId) : Promise.resolve(null),
    hasSuperAdminRole(db, session.user.id),
  ])

  return {
    role: siteRole?.role ?? 'viewer',
    isSuperAdmin,
  }
})
