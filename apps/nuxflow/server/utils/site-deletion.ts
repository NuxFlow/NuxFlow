import type { H3Event } from 'h3'
import { useDb } from './db'
import { clearSiteCache } from '../middleware/02.multi-site'
import { getActiveProvider } from './media-providers/index'
import { writeAuditLog } from './audit'
import {
  sites, users, userSiteRoles, media,
  accounts, sessions, passkeys
} from '@nuxflow/db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'

/**
 * Permanently deletes a site and every record scoped to it, including users who
 * have no role on any other site. Callers are responsible for authorization —
 * this performs no permission checks of its own.
 *
 * `actorUserId` is recorded both as a structured console line (survives even
 * when `siteId` is the site currently in request context, since step 3 below
 * deletes that site's own `audit_logs` rows via cascade as part of teardown) and,
 * when the acting request context is scoped to a *different* site than the one
 * being deleted, as a real audit log row that outlives the deletion.
 */
export async function deleteSiteCompletely(event: H3Event, siteId: string, actorUserId: string) {
  const db = useDb(event)

  console.warn(JSON.stringify({
    event: 'site.delete', siteId, actorUserId, at: new Date().toISOString(),
  }))

  if (event.context.siteId && event.context.siteId !== siteId) {
    await writeAuditLog(event, actorUserId, { action: 'delete', resource: 'site', resourceId: siteId })
  }

  // 1. Delete physical media files from the active storage provider. This is the one
  // step here that genuinely can't be a DB-level cascade — the provider (R2, S3,
  // Cloudflare Images, Bunny) is external storage, not a D1 table, so nothing short of
  // calling its API actually removes the files. Read the rows first (need storageKey),
  // then delete each file; the media *rows* themselves don't need a manual delete here —
  // see step 3 below, which removes them (and every other site-scoped table) via D1's
  // real foreign-key cascade.
  const allMedia = await db.select({ storageKey: media.storageKey }).from(media).where(eq(media.siteId, siteId))
  if (allMedia.length > 0) {
    const provider = await getActiveProvider(event)
    for (const file of allMedia) {
      await provider.delete(file.storageKey).catch(() => {})
    }
  }

  // 2. Handle users and roles. `user_site_roles` itself has an `onDelete: 'cascade'` FK to
  // sites.id, so the rows for this site don't need a manual delete here — step 3's final
  // `db.delete(sites)` removes them too. This read has to happen first regardless, to know
  // which users belong to this site at all.
  const siteRoles = await db
    .select({ userId: userSiteRoles.userId })
    .from(userSiteRoles)
    .where(eq(userSiteRoles.siteId, siteId))

  const siteUserIds = siteRoles.map(r => r.userId)

  if (siteUserIds.length > 0) {
    // Excludes this site's own (still-present) role rows explicitly, rather than relying
    // on them already being gone, so this check is correct regardless of whether the
    // cascade above has run yet.
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
      // users/accounts/sessions/passkeys have no FK to sites.id at all (accounts are
      // global, not per-site — see the multi-site note in CLAUDE.md), so these deletes
      // are genuinely manual — no cascade from the site delete below could ever reach
      // them. Batched so the 4 deletes are one atomic round trip.
      await db.batch([
        db.delete(accounts).where(inArray(accounts.userId, toDelete)),
        db.delete(sessions).where(inArray(sessions.userId, toDelete)),
        db.delete(passkeys).where(inArray(passkeys.userId, toDelete)),
        db.delete(users).where(inArray(users.id, toDelete)),
      ])
    }
  }

  // 3. Finally delete the site itself. D1 always enforces foreign keys — it cannot be
  // disabled (see https://developers.cloudflare.com/d1/sql-api/foreign-keys/) — so this
  // one delete real-cascades through every table with an `onDelete: 'cascade'` FK to
  // sites.id (content_items, content_types, taxonomies, site_settings, dynamic_plugins,
  // dynamic_plugin_trust, themes, audit_logs, notifications, api_keys, menus, redirects,
  // comments, forms, membership_tiers, subscriptions, push_subscriptions,
  // ai_generation_jobs, media_folders, video_assets, media, and user_site_roles — see
  // packages/db/src/schema/*.ts for the authoritative list), plus their own further
  // cascades (e.g. content_items -> content_revisions, taxonomies -> taxonomy_terms).
  // There is deliberately no manual per-table batch mirroring that list here — an
  // explicit copy would just be a second, driftable version of what the schema already
  // declares as REFERENCES ... ON DELETE CASCADE, and it would silently go stale exactly
  // like the previous version of this function did (it was missing forms, menus,
  // redirects, comments, membership tiers, subscriptions, push subscriptions, AI
  // generation jobs, media folders, and video assets, among others — those were only ever
  // cleaned up as a side effect of this same real cascade, not because of anything in the
  // old manual batch).
  await db.delete(sites).where(eq(sites.id, siteId))
  clearSiteCache()
}
