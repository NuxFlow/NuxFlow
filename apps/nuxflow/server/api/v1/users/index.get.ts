import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { userSiteRoles } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const roles = await db.query.userSiteRoles.findMany({
    where: eq(userSiteRoles.siteId, siteId),
    with: { user: { columns: { id: true, name: true, email: true, image: true, createdAt: true } } },
  })

  type UserRow = { id: string; name: string; email: string; image: string | null; createdAt: string }
  return {
    users: roles.filter(r => r.user).map((r) => ({
      ...(r.user as UserRow),
      role: r.role,
    })),
  }
})
