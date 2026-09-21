// ── Site metadata + settings restore ──────────────────────────────────────────
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { sites, siteSettings } from '@nuxflow/db/schema'
import type { Db } from '../db'
import { saveSetting } from '../settings'
import { clearBetterAuthCache } from '../better-auth'
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
    for (const [key, value] of Object.entries(backup.settings)) {
      const existing = await db.query.siteSettings.findFirst({
        where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, key)),
        columns: { id: true },
      })
      if (existing && opts.conflictMode !== 'overwrite') continue

      await saveSetting(event, key, value)
      result.settings.updated++
      if (key.startsWith('auth.')) touchedAuthSettings = true
    }
    if (touchedAuthSettings) clearBetterAuthCache()
  }
}
