// ── Site metadata + settings restore ──────────────────────────────────────────
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { sites, siteSettings } from '@nuxflow/db/schema'
import type { Db } from '../db'
import { saveSetting, SERVER_MANAGED_SETTING_KEYS } from '../settings'
import { clearBetterAuthCache } from '../better-auth'
import { SEO_SETTING_SCHEMAS } from '../seo-settings-schema'
import { clearSeoSettingsCache, getSeoSettings } from '../seo'
import { generateIndexNowKey } from '../indexnow'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

// Mirrors what buildBackup() exports (name/locale/timezone — see the `site` field on
// NuxFlowBackup) back onto the target site's own row. Gated on its own 'site' flag rather
// than always running or piggybacking on 'settings' (see the RestoreOptions comment).
export async function restoreSite(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (opts.what.includes('site') && backup.site) {
    await db.update(sites).set({
      name: backup.site.name,
      locale: backup.site.locale,
      timezone: backup.site.timezone,
      updatedAt: new Date().toISOString(),
    }).where(eq(sites.id, siteId))
    result.site.updated = true
  }
}

// Routed through saveSetting() rather than a raw insert/update — that's the single
// chokepoint that (a) encrypts sensitive keys under this deployment's own secret (the
// backup carries plaintext, decrypted on export above), and (b) busts the 30s
// per-isolate settings cache on write. Bypassing it (the previous behavior here) meant
// a restored setting could keep serving its pre-restore cached value for up to 30s on
// the isolate that served the restore. clearBetterAuthCache() below covers the same gap
// for OAuth credentials specifically — Better Auth caches a built instance per Host for
// 5 minutes, and restoring auth.google_client_id/auth.github_client_secret etc. would
// otherwise silently keep using pre-restore credentials for up to 5 minutes post-restore.
export async function restoreSettings(
  event: H3Event,
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (opts.what.includes('settings') && backup.settings) {
    let touchedAuthSettings = false
    let touchedSeoSettings = false
    for (const [key, raw] of Object.entries(backup.settings)) {
      // A backup/demo.json is hand-editable — never let it set a server-managed key (a
      // copied inbound handle would route another site's mail here).
      if (SERVER_MANAGED_SETTING_KEYS.has(key)) continue
      let value = raw
      // seo.* values get the same validation/normalization as a save from Admin → SEO
      // (seo-settings-schema.ts). A backup or theme demo.json is hand-editable, so an
      // invalid or unknown seo.* value is skipped rather than written — one bad value
      // shouldn't fail the rest of the restore.
      if (key.startsWith('seo.')) {
        const parsed = SEO_SETTING_SCHEMAS[key]?.safeParse(raw)
        if (!parsed?.success) continue
        value = parsed.data
      }

      const existing = await db.query.siteSettings.findFirst({
        where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)),
        columns: { id: true },
      })
      if (existing && opts.conflictMode !== 'overwrite') continue

      await saveSetting(event, key, value)
      result.settings.updated++
      if (key.startsWith('auth.')) touchedAuthSettings = true
      if (key.startsWith('seo.')) touchedSeoSettings = true
    }
    if (touchedAuthSettings) clearBetterAuthCache()
    if (touchedSeoSettings) {
      clearSeoSettingsCache(siteId)
      // IndexNow switched on by a backup/theme without a key of its own (a theme shouldn't
      // ship one — it's per site): generate it, the same as turning it on in Admin → SEO.
      const seo = await getSeoSettings(db, siteId)
      if (seo.indexnowEnabled && !seo.indexnowKey) {
        await saveSetting(event, 'seo.indexnow_key', generateIndexNowKey())
        clearSeoSettingsCache(siteId)
      }
    }
  }
}
