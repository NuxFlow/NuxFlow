import { useDb } from '../../../utils/db'
import { userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string | null

  const siteRole = siteId
    ? await db.query.userSiteRoles.findFirst({
        where: and(eq(userSiteRoles.userId, session.user.id), eq(userSiteRoles.siteId, siteId)),
        columns: { role: true },
      })
    : null

  const superAdminRow = await db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, session.user.id), eq(userSiteRoles.role, 'super_admin')),
    columns: { id: true },
  })

  return {
    role: siteRole?.role ?? 'viewer',
    isSuperAdmin: !!superAdminRow,
  }
})
