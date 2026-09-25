import type { H3Event } from 'h3'
import { useDb } from './db'
import { clearSiteCache } from '../middleware/02.multi-site'
import { getActiveProvider } from './media-providers/index'
import { writeAuditLog } from './audit'
import { deletePluginAssets } from './cf-plugin-kv'
import { deleteThemeCSS, deleteThemeDemo } from './cf-theme-kv'
import { errorMessage } from './errors'
import { deleteSiteEmailObjects } from './inbox'
import {
  sites, users, userSiteRoles, media,
  accounts, sessions, passkeys, themes, dynamicPlugins,
} from '@nuxflow/db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'

/**
 * Permanently deletes a site and every record scoped to it, including users who
 * have no role on any other site. Callers are responsible for authorization —
 * this performs no permission checks of its own.
 *
 * `actorUserId` is recorded both as a structured console line (survives even
 * when `siteId` is the site currently in request context, since step 4 below
 * deletes that site's own `audit_logs` rows via cascade as part of teardown) and,
 * when the acting request context is scoped to a *different* site than the one
 * being deleted, as a real audit log row that outlives the deletion — written at the
 * end, not the start, so it can record whether any media files failed to delete.
 */
export interface SiteDeletionResult {
  // Storage keys the active media provider failed to delete — the D1 `media` rows are
  // still gone (real FK cascade in step 4 below), but the underlying files may still
  // exist on the provider. Non-empty means an operator needs to check the provider
  // directly; see the note on the deletion loop below for why this can't just retry.
  failedMediaDeletes: string[]
}

export async function deleteSiteCompletely(event: H3Event, siteId: string, actorUserId: string): Promise<SiteDeletionResult> {
  const db = useDb(event)

  console.warn(JSON.stringify({
    event: 'site.delete', siteId, actorUserId, at: new Date().toISOString(),
  }))

  // 1. Delete physical media files from the active storage provider. This is the one
  // step here that genuinely can't be a DB-level cascade — the provider (R2, S3,
  // Cloudflare Images, Bunny) is external storage, not a D1 table, so nothing short of
  // calling its API actually removes the files. Read the rows first (need storageKey),
  // then delete each file; the media *rows* themselves don't need a manual delete here —
  // see step 4 below, which removes them (and every other site-scoped table) via D1's
  // real foreign-key cascade.
  //
  // A failed delete here is a genuine data-retention risk — the whole point of this
  // function is "permanently delete every record for this site," and an uploaded photo
  // can easily be personal data. The previous version of this loop swallowed every
  // failure with `.catch(() => {})` and no logging, so a provider error (wrong/expired
  // credentials, a site that switched providers mid-life leaving old files on the
  // no-longer-active one, a transient network failure) left files behind with nothing
  // anywhere recording that erasure didn't actually happen. Each failure is now logged
  // with the storage key and returned to the caller so it can surface to whoever
  // triggered the deletion instead of disappearing silently.
  const allMedia = await db.select({ storageKey: media.storageKey }).from(media).where(eq(media.siteId, siteId))
  const failedMediaDeletes: string[] = []
  if (allMedia.length > 0) {
    const provider = await getActiveProvider(event)
    for (const file of allMedia) {
      try {
        await provider.delete(file.storageKey)
      }
      catch (err) {
        failedMediaDeletes.push(file.storageKey)
        console.error(JSON.stringify({
          event: 'site.delete.media_failed', siteId, storageKey: file.storageKey,
          error: errorMessage(err, String(err)),
        }))
      }
    }
  }

  // 1b. Received email (raw messages + attachments) lives in R2 under a private prefix —
  // the email_messages rows go with the step-4 cascade, the objects don't. It's personal
  // data from outside senders, so a failure is surfaced like a media failure.
  try {
    await deleteSiteEmailObjects(event, siteId)
  }
  catch (err) {
    failedMediaDeletes.push(`_private/${siteId}/email/*`)
    console.error(JSON.stringify({ event: 'site.delete.email_failed', siteId, error: errorMessage(err, String(err)) }))
  }

  // 2. Delete KV-stored theme CSS/demo data and dynamic plugin server/client code for
  // this site. Like media above, these live outside D1 (Cloudflare KV), so the FK
  // cascade in step 4 removes the `themes`/`dynamic_plugins` *rows* but can never touch
  // their KV-side payloads — left alone, every theme this site ever published and every
  // plugin it ever installed would stay in KV forever under a siteId that no longer
  // resolves to anything. Must run before step 4's cascade delete: deleteThemeCSS needs
  // the theme row's current `cssVersion` to know which KV key to remove, which is only
  // available while the row still exists. Best-effort like media deletion above — CSS/
  // plugin code isn't personal data, so a failure here is logged but doesn't block the
  // rest of the deletion.
  const siteThemes = await db.select({ id: themes.id }).from(themes).where(eq(themes.siteId, siteId))
  const sitePlugins = await db.select({ id: dynamicPlugins.id }).from(dynamicPlugins).where(eq(dynamicPlugins.siteId, siteId))
  try {
    await Promise.all([
      ...siteThemes.flatMap(t => [deleteThemeCSS(event, siteId, t.id), deleteThemeDemo(event, siteId, t.id)]),
      ...sitePlugins.map(p => deletePluginAssets(event, siteId, p.id)),
    ])
  }
  catch (err) {
    console.error(JSON.stringify({ event: 'site.delete.kv_cleanup_failed', siteId, error: errorMessage(err, String(err)) }))
  }

  // 3. Handle users and roles. `user_site_roles` itself has an `onDelete: 'cascade'` FK to
  // sites.id, so the rows for this site don't need a manual delete here — step 4's final
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

  // 4. Finally delete the site itself. D1 always enforces foreign keys — it cannot be
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

  if (event.context.siteId && event.context.siteId !== siteId) {
    await writeAuditLog(event, actorUserId, {
      action: 'delete',
      resource: 'site',
      resourceId: siteId,
      after: failedMediaDeletes.length ? { failedMediaDeletes } : undefined,
    })
  }

  return { failedMediaDeletes }
}
