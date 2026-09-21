// ── Backup / restore barrel ────────────────────────────────────────────────────
// This file used to hold the entire backup/restore implementation (~1400 lines): backup
// format types + Zod validation, buildBackup() (export), and one ~700-line applyBackup()
// covering all 9 restore domains. It's now split for maintainability:
//   - backup-types.ts    — the NuxFlowBackup shape, its Zod schema, parseBackupJson(),
//                          rewriteImageUrls(), and the RestoreOptions/RestoreResult types
//                          every restore-domain module shares.
//   - backup-export.ts   — buildBackup().
//   - backup-restore/*   — one module per restore domain (site+settings, taxonomies,
//                          content, menus, forms, themes, plugins, users, membership
//                          tiers), each taking only the (event, db, siteId, backup, opts,
//                          result) subset it actually needs.
// This file re-exports everything from those modules so the many existing call sites
// (server/api/v1/themes/**, server/api/v1/restore.post.ts, server/api/v1/backup.get.ts,
// and integration tests) keep importing from 'utils/backup' unchanged, and hosts the thin
// applyBackup() orchestrator that runs each restore domain in the original order.
import type { H3Event } from 'h3'
import { useDb } from './db'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from './backup-types'
import { restoreSite, restoreSettings } from './backup-restore/restore-site'
import { restoreTaxonomies } from './backup-restore/restore-taxonomies'
import { restoreContent } from './backup-restore/restore-content'
import { restoreMenus } from './backup-restore/restore-menus'
import { restoreForms } from './backup-restore/restore-forms'
import { restoreThemes } from './backup-restore/restore-themes'
import { restorePlugins } from './backup-restore/restore-plugins'
import { restoreUsers } from './backup-restore/restore-users'
import { restoreMembershipTiers } from './backup-restore/restore-tiers'

export * from './backup-types'
export * from './backup-export'

// ── Restore (apply backup to a site) ─────────────────────────────────────────
// Runs every restore domain unconditionally — each one checks `opts.what` itself and
// no-ops when its section isn't requested, matching the original single-function
// behavior exactly. Order matters: taxonomies must run before content (content's term
// assignments resolve through the termIdBySlugPath taxonomies restore returns).
export async function applyBackup(
  event: H3Event,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
): Promise<RestoreResult> {
  const db = useDb(event)
  const result: RestoreResult = {
    site: { updated: false },
    content: { created: 0, updated: 0, skipped: 0 },
    taxonomies: { created: 0 },
    terms: { created: 0 },
    menus: { created: 0 },
    forms: { created: 0 },
    settings: { updated: 0 },
    themes: { created: 0, updated: 0, skipped: 0 },
    plugins: { created: 0, updated: 0, skipped: 0, rejected: 0 },
    users: { created: 0, updated: 0, skipped: 0 },
    membershipTiers: { created: 0, updated: 0, skipped: 0 },
  }

  await restoreSite(db, siteId, backup, opts, result)
  await restoreSettings(event, db, siteId, backup, opts, result)

  const termIdBySlugPath = await restoreTaxonomies(db, siteId, backup, opts, result)
  await restoreContent(db, siteId, backup, opts, result, termIdBySlugPath)

  await restoreMenus(db, siteId, backup, opts, result)
  await restoreForms(db, siteId, backup, opts, result)
  await restoreThemes(event, db, siteId, backup, opts, result)
  await restorePlugins(event, db, siteId, backup, opts, result)
  await restoreUsers(event, db, siteId, backup, opts, result)
  await restoreMembershipTiers(db, siteId, backup, opts, result)

  return result
}
