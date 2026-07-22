import type { H3Event } from 'h3'
import { useDb } from './db'
import { getActiveProvider } from './media-providers/index'
import {
  sites, users, userSiteRoles, contentItems, contentTypes,
  taxonomies, siteSettings, dynamicPlugins, themes,
  auditLogs, notifications, media, apiKeys,
  accounts, sessions, passkeys
} from '@nuxflow/db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'

/**
 * Permanently deletes a site and every record scoped to it, including users who
 * have no role on any other site. Callers are responsible for authorization —
 * this performs no permission checks of its own.
 */
export async function deleteSiteCompletely(event: H3Event, siteId: string) {
  const db = useDb(event)

  // 1. Delete physical media files
  const allMedia = await db.select({ storageKey: media.storageKey }).from(media).where(eq(media.siteId, siteId))
  if (allMedia.length > 0) {
    const provider = await getActiveProvider(event)
    for (const file of allMedia) {
      await provider.delete(file.storageKey).catch(() => {})
    }
  }
  await db.delete(media).where(eq(media.siteId, siteId))

  // 2. Delete site-owned records manually to ensure they're removed
  // (In case PRAGMA foreign_keys is not ON in the DB environment like D1)
  await db.delete(contentItems).where(eq(contentItems.siteId, siteId))
  await db.delete(contentTypes).where(eq(contentTypes.siteId, siteId))
  await db.delete(taxonomies).where(eq(taxonomies.siteId, siteId))
  await db.delete(siteSettings).where(eq(siteSettings.siteId, siteId))
  await db.delete(dynamicPlugins).where(eq(dynamicPlugins.siteId, siteId))
  await db.delete(themes).where(eq(themes.siteId, siteId))
  await db.delete(auditLogs).where(eq(auditLogs.siteId, siteId))
  await db.delete(notifications).where(eq(notifications.siteId, siteId))
  await db.delete(apiKeys).where(eq(apiKeys.siteId, siteId))

  // 3. Handle users and roles
  const siteRoles = await db
    .select({ userId: userSiteRoles.userId })
    .from(userSiteRoles)
    .where(eq(userSiteRoles.siteId, siteId))

  const siteUserIds = siteRoles.map(r => r.userId)

  // Remove the roles for this site
  await db.delete(userSiteRoles).where(eq(userSiteRoles.siteId, siteId))

  if (siteUserIds.length > 0) {
    const sharedRoles = await db
      .select({ userId: userSiteRoles.userId })
      .from(userSiteRoles)
      .where(and(
        inArray(userSiteRoles.userId, siteUserIds),
        ne(userSiteRoles.siteId, siteId),
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
  await db.delete(sites).where(eq(sites.id, siteId))
}
