// ── Themes restore ─────────────────────────────────────────────────────────────
// Matched by packageName (the closest thing themes have to a natural slug — `id` is a
// generated ulid, regenerated on insert here same as everywhere else in this file).
// A restored theme is always inserted inactive, even in overwrite mode: silently
// swapping the live theme's CSS out from under a running site is a bigger surprise than
// leaving the admin to activate it deliberately from Admin → Themes afterward.
import type { H3Event } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { themes } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import { putThemeCSS, putThemeDemo } from '../cf-theme-kv'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

export async function restoreThemes(
  event: H3Event,
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('themes') || !backup.themes) return

  // One prefetch instead of one findFirst() per theme.
  const themePackageNames = backup.themes.map(t => t.packageName)
  const existingThemeRows = themePackageNames.length > 0
    ? await db.query.themes.findMany({
        where: and(eq(themes.siteId, siteId), inArray(themes.packageName, themePackageNames)),
        columns: { id: true, packageName: true },
      })
    : []
  const themeByPackageName = new Map(existingThemeRows.map(t => [t.packageName, t]))

  for (const backupTheme of backup.themes) {
    const existing = themeByPackageName.get(backupTheme.packageName)

    if (existing && opts.conflictMode === 'skip') {
      result.themes.skipped++
      continue
    }

    if (existing && opts.conflictMode === 'overwrite') {
      await db.update(themes).set({
        name: backupTheme.name,
        version: backupTheme.version,
        hasCss: backupTheme.hasCss,
        settings: backupTheme.settings ?? undefined,
      }).where(eq(themes.id, existing.id))
      if (backupTheme.hasCss && backupTheme.css) await putThemeCSS(event, siteId, existing.id, backupTheme.css)
      if (backupTheme.demo) await putThemeDemo(event, siteId, existing.id, backupTheme.demo)
      result.themes.updated++
      continue
    }

    // No conflict, or conflictMode === 'archive' (existing theme is left untouched —
    // themes don't carry the "current draft" ambiguity content/menus/forms do, so
    // there's nothing to rename, just a second inactive theme to pick from).
    const id = ulid()
    const packageName = existing
      ? `${backupTheme.packageName}-backup-${Date.now()}`
      : backupTheme.packageName
    await db.insert(themes).values({
      id, siteId,
      packageName,
      name: backupTheme.name,
      version: backupTheme.version,
      isActive: false,
      hasCss: backupTheme.hasCss,
      settings: backupTheme.settings ?? undefined,
    })
    if (backupTheme.hasCss && backupTheme.css) await putThemeCSS(event, siteId, id, backupTheme.css)
    if (backupTheme.demo) await putThemeDemo(event, siteId, id, backupTheme.demo)
    result.themes.created++
    // Only record a genuinely new packageName — a duplicate entry for an
    // already-`existing` packageName must keep matching it on a later iteration (in
    // 'archive' mode that existing row is deliberately left untouched, so it should
    // still count as a conflict every time, exactly like the original per-row query
    // would have found it again on every call).
    if (!existing) themeByPackageName.set(packageName, { id, packageName })
  }
}
