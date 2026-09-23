// Single source of truth for which role an admin section requires — consumed by both
// AdminSidebar.vue (hides nav items the current user can't use) and the
// 02.admin-role-guard.global.ts route middleware (bounces direct navigation to a page the
// user has no business on). Keeping one shared list avoids the nav and the guard
// silently drifting apart.
//
// This is presentation-layer gating only — hiding links and redirecting to a friendlier
// "access denied" page instead of a raw 403 from a failed fetch. The real authorization
// boundary is server-side (requireRole()/requireSuperAdmin() in server/utils/permissions.ts).
// minRole values here mirror each section's actual minimum server-side requirement (the
// lowest role that can do anything useful there, usually the read role) — see CLAUDE.md's
// "Permission helpers" section for the authoritative per-route table this was built from.

export type Role = 'super_admin' | 'admin' | 'editor' | 'author' | 'viewer' | 'member'

// Mirrors server/utils/permissions.ts's ROLE_RANK. Duplicated rather than imported
// because the server file pulls in useDb()/D1-specific utilities that don't belong in
// the client bundle — this table itself is small and pure, safe to keep in sync by hand.
const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  admin: 80,
  editor: 60,
  author: 40,
  member: 20,
  viewer: 10,
}

export function roleAtLeast(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

export interface AdminNavItem {
  label: string
  to: string
  icon: string
  /** Lowest role (per the ranking above) that can use this section at all. Omit for "any real role" (viewer floor). */
  minRole?: Role
  /** Requires requireSuperAdmin() cross-site status, not a per-site role. */
  superAdminOnly?: boolean
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Dashboard', to: '/admin', icon: 'i-lucide-layout-dashboard' },
  { label: 'Content', to: '/admin/content', icon: 'i-lucide-file-text' },
  { label: 'Generate with AI', to: '/admin/content/generate', icon: 'i-lucide-sparkles', minRole: 'editor' },
  { label: 'Calendar', to: '/admin/calendar', icon: 'i-lucide-calendar-days' },
  { label: 'Taxonomies', to: '/admin/taxonomies', icon: 'i-lucide-tag' },
  { label: 'Comments', to: '/admin/comments', icon: 'i-lucide-message-circle', minRole: 'editor' },
  { label: 'Navigation', to: '/admin/menus', icon: 'i-lucide-navigation' },
  { label: 'Media', to: '/admin/media', icon: 'i-lucide-image' },
  { label: 'Videos', to: '/admin/media/videos', icon: 'i-lucide-video' },
  { label: 'Forms', to: '/admin/forms', icon: 'i-lucide-list-checks', minRole: 'editor' },
  { label: 'Contact Forms', to: '/admin/contact-forms', icon: 'i-lucide-mail', minRole: 'editor' },
  { label: 'Users', to: '/admin/users', icon: 'i-lucide-users', minRole: 'admin' },
  { label: 'Memberships', to: '/admin/memberships', icon: 'i-lucide-credit-card', minRole: 'admin' },
  { label: 'Themes', to: '/admin/themes', icon: 'i-lucide-palette', minRole: 'admin' },
  { label: 'Plugins', to: '/admin/plugins', icon: 'i-lucide-puzzle', minRole: 'admin' },
  { label: 'SEO', to: '/admin/seo', icon: 'i-lucide-search', minRole: 'admin' },
  { label: 'Import', to: '/admin/import', icon: 'i-lucide-upload', minRole: 'admin' },
  { label: 'Settings', to: '/admin/settings', icon: 'i-lucide-settings', minRole: 'admin' },
]

export const SUPER_ADMIN_NAV: AdminNavItem[] = [
  { label: 'Sites', to: '/admin/super/sites', icon: 'i-lucide-globe', superAdminOnly: true },
  { label: 'Database', to: '/admin/super/database', icon: 'i-lucide-database', superAdminOnly: true },
]

export function canAccessNavItem(item: AdminNavItem, access: { role: Role | null; isSuperAdmin: boolean } | null | undefined): boolean {
  if (item.superAdminOnly) return access?.isSuperAdmin ?? false
  return roleAtLeast(access?.role, item.minRole ?? 'viewer')
}

// Longest-prefix match so a more specific rule (e.g. /admin/super/database) wins over a
// broader one that happens to share a prefix.
export function findNavRule(path: string): AdminNavItem | undefined {
  const all = [...ADMIN_NAV, ...SUPER_ADMIN_NAV]
  let best: AdminNavItem | undefined
  for (const item of all) {
    if (path === item.to || path.startsWith(`${item.to}/`)) {
      if (!best || item.to.length > best.to.length) best = item
    }
  }
  return best
}
