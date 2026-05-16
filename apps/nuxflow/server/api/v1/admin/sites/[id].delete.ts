import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { sites, users, userSiteRoles } from '@nuxflow/db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)
  const id = getRouterParam(event, 'id')!

  // Delete users who exist solely for this site so that re-running setup
  // with the same email doesn't hit a UNIQUE constraint on users.email.
  // Users with roles on other sites are left untouched.
  const siteRoles = await db
    .select({ userId: userSiteRoles.userId })
    .from(userSiteRoles)
    .where(eq(userSiteRoles.siteId, id))

  const siteUserIds = siteRoles.map(r => r.userId)

  if (siteUserIds.length > 0) {
    const sharedRoles = await db
      .select({ userId: userSiteRoles.userId })
      .from(userSiteRoles)
      .where(and(
        inArray(userSiteRoles.userId, siteUserIds),
        ne(userSiteRoles.siteId, id),
      ))

    const sharedIds = new Set(sharedRoles.map(r => r.userId))
    const toDelete = siteUserIds.filter(uid => !sharedIds.has(uid))

    for (const userId of toDelete) {
      // Cascades to accounts, sessions, verifications, api_keys, notifications.
      await db.delete(users).where(eq(users.id, userId))
    }
  }

  // Cascades to all site-owned tables (content, media, settings, themes, etc.).
  await db.delete(sites).where(eq(sites.id, id))

  return { id }
})
