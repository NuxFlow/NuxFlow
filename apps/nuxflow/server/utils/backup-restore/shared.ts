// Small helpers shared across the restore-domain modules in this directory.

// Formats "now" for embedding in an archived slug/name/title, e.g. producing
// "2026-09-20T12-34-56" from an ISO timestamp. `conflictMode: 'archive'` renames the
// pre-existing conflicting row (content, menus, forms) rather than overwriting or
// skipping it, and all three call sites need the exact same timestamp format so archived
// names look consistent across domains.
export function archiveSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}
