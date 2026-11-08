// Small helpers shared across the restore-domain modules in this directory.

// Formats "now" for embedding in an archived slug/name/title, e.g. producing
// "2026-09-20T12-34-56" from an ISO timestamp. `conflictMode: 'archive'` renames the
// pre-existing conflicting row (content, menus, forms) rather than overwriting or
// skipping it, and all three call sites need the exact same timestamp format so archived
// names look consistent across domains.
export function archiveSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

/**
 * An archived slug no other row uses: `base`, else `base-2`, `base-3`… The timestamp is
 * only to the second, so two archives of the same slug within one second (switching
 * starter sites twice in a row, a retried restore) would otherwise hit the unique index.
 */
export async function freeArchiveSlug(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await isTaken(base))) return base
  for (let n = 2; n < 100; n++) {
    if (!(await isTaken(`${base}-${n}`))) return `${base}-${n}`
  }
  return `${base}-${Date.now().toString(36)}`
}
