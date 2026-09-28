// ── Redirects restore ─────────────────────────────────────────────────────────
import type { Db } from '../db'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'
import { redirectRuleSchema, saveRedirect } from '../redirects'

// Goes through the same validation and saveRedirect() (one rule per normalized source
// path, chains flattened) as the Redirects API, so a hand-edited backup can't introduce a
// self-redirect or a javascript: target. 'overwrite' replaces a rule with the same source
// path; 'skip' and 'archive' keep the existing rule (a redirect has nothing to archive to).
export async function restoreRedirects(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('redirects') || !backup.redirects?.length) return

  for (const raw of backup.redirects) {
    const parsed = redirectRuleSchema.safeParse(raw)
    if (!parsed.success) {
      result.redirects.skipped++
      continue
    }
    const saved = await saveRedirect(db, siteId, parsed.data, { overwrite: opts.conflictMode === 'overwrite' })
    if (saved.action === 'created') result.redirects.created++
    else if (saved.action === 'updated') result.redirects.updated++
    else result.redirects.skipped++
  }
}
