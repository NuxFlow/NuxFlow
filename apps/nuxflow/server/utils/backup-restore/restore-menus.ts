// ── Menus restore ──────────────────────────────────────────────────────────────
import { and, eq, inArray } from 'drizzle-orm'
import { menus } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'
import { archiveSuffix } from './shared'

export async function restoreMenus(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('menus') || !backup.menus) return

  // One prefetch instead of one findFirst() per menu.
  const menuNames = backup.menus.map(m => m.name)
  const existingMenuRows = menuNames.length > 0
    ? await db.query.menus.findMany({
        where: and(eq(menus.siteId, siteId), inArray(menus.name, menuNames)),
        columns: { name: true },
      })
    : []
  const existingMenuNames = new Set(existingMenuRows.map(m => m.name))

  for (const backupMenu of backup.menus) {
    if (existingMenuNames.has(backupMenu.name)) {
      if (opts.conflictMode === 'archive') {
        const timestamp = archiveSuffix()
        await db.update(menus).set({
          name: `${backupMenu.name} (Backup — ${timestamp})`,
          location: null, // clear header/footer location so the new menu can take over!
        }).where(and(eq(menus.siteId, siteId), eq(menus.name, backupMenu.name)))
        // The renamed row no longer occupies `backupMenu.name` — clear it so a later
        // duplicate-named entry in the same (user-editable) backup.json inserts cleanly
        // instead of re-triggering this branch against a name that's already moved on.
        existingMenuNames.delete(backupMenu.name)
      } else {
        continue
      }
    }
    await db.insert(menus).values({
      id: ulid(), siteId,
      name: backupMenu.name,
      location: backupMenu.location,
      items: backupMenu.items,
    })
    result.menus.created++
    existingMenuNames.add(backupMenu.name)
  }
}
