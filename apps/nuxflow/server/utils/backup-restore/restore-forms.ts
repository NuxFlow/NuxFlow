// ── Forms restore ─────────────────────────────────────────────────────────────
import { and, eq, inArray } from 'drizzle-orm'
import { forms } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'
import { archiveSuffix } from './shared'

export async function restoreForms(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('forms') || !backup.forms) return

  // One prefetch instead of one findFirst() per form.
  const formSlugs = backup.forms.map(f => f.slug)
  const existingFormRows = formSlugs.length > 0
    ? await db.query.forms.findMany({
        where: and(eq(forms.siteId, siteId), inArray(forms.slug, formSlugs)),
        columns: { slug: true, name: true },
      })
    : []
  const formBySlug = new Map(existingFormRows.map(f => [f.slug, f]))

  for (const backupForm of backup.forms) {
    const existing = formBySlug.get(backupForm.slug)
    if (existing) {
      if (opts.conflictMode === 'archive') {
        const timestamp = archiveSuffix()
        await db.update(forms).set({
          slug: `${existing.slug}-backup-${timestamp}`,
          name: `${existing.name} (Backup — ${timestamp})`,
          status: 'closed',
        }).where(and(eq(forms.siteId, siteId), eq(forms.slug, backupForm.slug)))
        // The renamed row no longer occupies `backupForm.slug` — see the equivalent
        // comment in the menus section above for why this matters for duplicate keys
        // within the same backup.
        formBySlug.delete(backupForm.slug)
      } else {
        continue
      }
    }
    await db.insert(forms).values({
      id: ulid(), siteId,
      slug: backupForm.slug,
      name: backupForm.name,
      fields: backupForm.fields as FormField[],
      notifications: backupForm.notifications as Record<string, unknown> | undefined,
      redirectUrl: backupForm.redirectUrl,
      status: backupForm.status as 'active' | 'draft' | 'closed',
    })
    result.forms.created++
    formBySlug.set(backupForm.slug, { slug: backupForm.slug, name: backupForm.name })
  }
}
