import { useDb } from '../../../../utils/db'
import { requireSuperAdmin } from '../../../../utils/permissions'
import { getActiveProvider } from '../../../../utils/media-providers/index'
import {
  sites, users, userSiteRoles, contentItems, contentTypes,
  taxonomies, siteSettings, dynamicPlugins, themes,
  auditLogs, notifications, webhooks, media, apiKeys,
  accounts, sessions, passkeys
} from '@nuxflow/db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  const db = useDb(event)
  const id = getRouterParam(event, 'id')!

  if (id === event.context.siteId) {
    throw createError({ statusCode: 409, message: 'Cannot delete the site you are currently viewing. Switch to another domain first.' })
  }

  // 1. Delete physical media files
  const allMedia = await db.select({ storageKey: media.storageKey }).from(media).where(eq(media.siteId, id))
  if (allMedia.length > 0) {
    const provider = getActiveProvider()
    for (const file of allMedia) {
      await provider.delete(file.storageKey).catch(() => {})
    }
  }
  await db.delete(media).where(eq(media.siteId, id))

  // 2. Delete site-owned records manually to ensure they're removed
  // (In case PRAGMA foreign_keys is not ON in the DB environment like D1)
  await db.delete(contentItems).where(eq(contentItems.siteId, id))
  await db.delete(contentTypes).where(eq(contentTypes.siteId, id))
  await db.delete(taxonomies).where(eq(taxonomies.siteId, id))
  await db.delete(siteSettings).where(eq(siteSettings.siteId, id))
  await db.delete(dynamicPlugins).where(eq(dynamicPlugins.siteId, id))
  await db.delete(themes).where(eq(themes.siteId, id))
  await db.delete(auditLogs).where(eq(auditLogs.siteId, id))
  await db.delete(notifications).where(eq(notifications.siteId, id))
  await db.delete(webhooks).where(eq(webhooks.siteId, id))
  await db.delete(apiKeys).where(eq(apiKeys.siteId, id))

  // 3. Handle users and roles
  const siteRoles = await db
    .select({ userId: userSiteRoles.userId })
    .from(userSiteRoles)
    .where(eq(userSiteRoles.siteId, id))

  const siteUserIds = siteRoles.map(r => r.userId)

  // Remove the roles for this site
  await db.delete(userSiteRoles).where(eq(userSiteRoles.siteId, id))

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

    if (toDelete.length > 0) {
      // Manually delete user-owned records
      await db.delete(accounts).where(inArray(accounts.userId, toDelete))
      await db.delete(sessions).where(inArray(sessions.userId, toDelete))
      await db.delete(passkeys).where(inArray(passkeys.userId, toDelete))
      // Delete the users
      await db.delete(users).where(inArray(users.id, toDelete))
    }
  }

  // 4. Finally delete the site itself
  await db.delete(sites).where(eq(sites.id, id))

  return { id }
})
