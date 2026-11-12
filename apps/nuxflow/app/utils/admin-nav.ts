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

import { isTeamRole, roleAtLeast, type Role } from '@nuxflow/db/roles'

// Re-exported so pages and components get them through Nuxt's auto-imports.
export { isTeamRole, roleAtLeast, type Role }

export interface AdminNavItem {
  label: string
  to: string
  icon: string
  /** Lowest role (per the ranking above) that can use this section at all. Omit for "any real role" (viewer floor). */
  minRole?: Role
  /** Requires requireSuperAdmin() cross-site status, not a per-site role. */
  superAdminOnly?: boolean
  /** Only exists while Super Admin → Platform's hosting-platform switch is on. */
  hostingOnly?: boolean
  /** Only while the site's shop is on (Admin → Shop). */
  shopOnly?: boolean
  /** Route-guard rule only — not listed in the sidebar (a sub-page reached from its parent). */
  hidden?: boolean
  /** The sidebar group this link sits in. Omit for a link at the top level. */
  group?: AdminNavGroup
  /** For a hidden item: the `to` of the sidebar link to light up while on this page. */
  highlights?: string
}

// The arrays below stay flat, in display order: the route guard and the role tests read every
// item the same way wherever it sits, and only the sidebar cares about groups.
export const ADMIN_NAV_GROUPS = {
  content: { label: 'Content', icon: 'i-lucide-file-text' },
  media: { label: 'Media', icon: 'i-lucide-image' },
  audience: { label: 'Audience', icon: 'i-lucide-messages-square' },
  sales: { label: 'Sales', icon: 'i-lucide-credit-card' },
  site: { label: 'Site', icon: 'i-lucide-panels-top-left' },
  administration: { label: 'Administration', icon: 'i-lucide-settings' },
  super: { label: 'Super Admin', icon: 'i-lucide-shield' },
} as const satisfies Record<string, { label: string; icon: string }>

export type AdminNavGroup = keyof typeof ADMIN_NAV_GROUPS

/** Open in a browser that has no remembered menu yet: it's where most visits are heading. */
export const DEFAULT_OPEN_NAV_GROUP: AdminNavGroup = 'content'

const POSTS_TO = '/admin/content?type=post'
const EVENTS_TO = '/admin/content?type=event'
const PRODUCTS_TO = '/admin/content?type=product'

export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Dashboard', to: '/admin', icon: 'i-lucide-layout-dashboard' },
  { label: 'Analytics', to: '/admin/analytics', icon: 'i-lucide-chart-line', minRole: 'editor' },

  { label: 'All content', to: '/admin/content', icon: 'i-lucide-files', group: 'content' },
  { label: 'Posts', to: POSTS_TO, icon: 'i-lucide-newspaper', group: 'content' },
  { label: 'Events', to: EVENTS_TO, icon: 'i-lucide-calendar-check', group: 'content' },
  // Attendee lists are personal data, reached from an event's editor. Same floor as their API.
  { label: 'Attendees', to: '/admin/events', icon: 'i-lucide-users', minRole: 'editor', hidden: true, group: 'content', highlights: EVENTS_TO },
  { label: 'Calendar', to: '/admin/calendar', icon: 'i-lucide-calendar-days', group: 'content' },
  { label: 'Categories & tags', to: '/admin/taxonomies', icon: 'i-lucide-tag', minRole: 'editor', group: 'content' },
  { label: 'Content types', to: '/admin/content-types', icon: 'i-lucide-shapes', minRole: 'admin', group: 'content' },
  { label: 'Generate with AI', to: '/admin/content/generate', icon: 'i-lucide-sparkles', minRole: 'editor', group: 'content' },

  { label: 'Library', to: '/admin/media', icon: 'i-lucide-images', group: 'media' },
  { label: 'Videos', to: '/admin/media/videos', icon: 'i-lucide-video', group: 'media' },

  { label: 'Inbox', to: '/admin/inbox', icon: 'i-lucide-inbox', minRole: 'editor', group: 'audience' },
  { label: 'Inbox addresses', to: '/admin/inbox/mailboxes', icon: 'i-lucide-at-sign', minRole: 'admin', hidden: true, group: 'audience', highlights: '/admin/inbox' },
  { label: 'Comments', to: '/admin/comments', icon: 'i-lucide-message-circle', minRole: 'editor', group: 'audience' },
  { label: 'Forms', to: '/admin/forms', icon: 'i-lucide-list-checks', minRole: 'editor', group: 'audience' },
  // Admin only: it's a list of visitors' email addresses (personal data).
  { label: 'Mailing list', to: '/admin/mailing-list', icon: 'i-lucide-mail-plus', minRole: 'admin', group: 'audience' },

  { label: 'Products', to: PRODUCTS_TO, icon: 'i-lucide-shopping-bag', minRole: 'editor', shopOnly: true, group: 'sales' },
  { label: 'Orders', to: '/admin/orders', icon: 'i-lucide-receipt', minRole: 'admin', group: 'sales' },
  { label: 'Shop', to: '/admin/shop', icon: 'i-lucide-store', minRole: 'admin', group: 'sales' },
  { label: 'Memberships', to: '/admin/memberships', icon: 'i-lucide-badge-check', minRole: 'admin', group: 'sales' },
  { label: 'Class passes', to: '/admin/class-passes', icon: 'i-lucide-ticket', minRole: 'admin', group: 'sales' },
  { label: 'Appointments', to: '/admin/appointments', icon: 'i-lucide-calendar-clock', minRole: 'editor', group: 'sales' },

  { label: 'Themes', to: '/admin/themes', icon: 'i-lucide-palette', minRole: 'admin', group: 'site' },
  { label: 'Starter sites', to: '/admin/starters', icon: 'i-lucide-layout-template', minRole: 'admin', group: 'site' },
  // The GET is open to any team role, but all this page does is manage menus, so its floor is
  // the create route's.
  { label: 'Navigation', to: '/admin/menus', icon: 'i-lucide-navigation', minRole: 'editor', group: 'site' },
  // Editors get Redirects and the SEO audit; the settings tabs on that page are admin-only
  // (PATCH /api/v1/settings requires admin).
  { label: 'SEO', to: '/admin/seo', icon: 'i-lucide-search', minRole: 'editor', group: 'site' },
  { label: 'Plugins', to: '/admin/plugins', icon: 'i-lucide-puzzle', minRole: 'admin', group: 'site' },

  { label: 'Users', to: '/admin/users', icon: 'i-lucide-users', minRole: 'admin', group: 'administration' },
  { label: 'Import & backup', to: '/admin/import', icon: 'i-lucide-hard-drive-download', minRole: 'admin', group: 'administration' },
  { label: 'Settings', to: '/admin/settings', icon: 'i-lucide-sliders-horizontal', minRole: 'admin', group: 'administration' },
]

export const SUPER_ADMIN_NAV: AdminNavItem[] = [
  { label: 'Sites', to: '/admin/super/sites', icon: 'i-lucide-globe', superAdminOnly: true, group: 'super' },
  { label: 'Plans', to: '/admin/super/plans', icon: 'i-lucide-layers', superAdminOnly: true, hostingOnly: true, group: 'super' },
  { label: 'Usage', to: '/admin/super/usage', icon: 'i-lucide-chart-column', superAdminOnly: true, hostingOnly: true, group: 'super' },
  { label: 'Pools', to: '/admin/super/pools', icon: 'i-lucide-boxes', superAdminOnly: true, hostingOnly: true, group: 'super' },
  { label: 'Database', to: '/admin/super/database', icon: 'i-lucide-database', superAdminOnly: true, group: 'super' },
  { label: 'Email log', to: '/admin/super/email', icon: 'i-lucide-send', superAdminOnly: true, group: 'super' },
  { label: 'Platform', to: '/admin/super/platform', icon: 'i-lucide-server', superAdminOnly: true, group: 'super' },
]

export type AdminNavEntry =
  | { kind: 'link'; item: AdminNavItem }
  | { kind: 'group'; group: AdminNavGroup; label: string; icon: string; items: AdminNavItem[] }

/**
 * Turns the links a user can see into what the sidebar shows, keeping their order. A group
 * left with one link becomes that link: a menu to open for a single choice is just a slower link.
 */
export function groupNavItems(items: AdminNavItem[]): AdminNavEntry[] {
  const entries: AdminNavEntry[] = []
  for (const item of items) {
    if (!item.group) {
      entries.push({ kind: 'link', item })
      continue
    }
    const existing = entries.find(e => e.kind === 'group' && e.group === item.group)
    if (existing?.kind === 'group') existing.items.push(item)
    else entries.push({ kind: 'group', group: item.group, ...ADMIN_NAV_GROUPS[item.group], items: [item] })
  }
  return entries.map(e => (e.kind === 'group' && e.items.length === 1 ? { kind: 'link', item: e.items[0]! } : e))
}

/**
 * The one sidebar link that stands for this page, as its `to`. `contentType` is the type being
 * listed or edited, because Posts and Events are the content list and editor under another name.
 */
export function activeNavTo(path: string, contentType?: unknown): string | undefined {
  const rule = findNavRule(path)
  if (!rule) return undefined
  if (rule.highlights) return rule.highlights
  // Everything under /admin matches the Dashboard's rule, but only /admin itself is the dashboard.
  if (rule.to === '/admin' && path !== '/admin') return undefined
  if (rule.to === '/admin/content') {
    if (contentType === 'post') return POSTS_TO
    if (contentType === 'event') return EVENTS_TO
  }
  return rule.to
}

/** The group holding a link, by its `to`. */
export function navGroupOf(to: string | undefined): AdminNavGroup | undefined {
  return [...ADMIN_NAV, ...SUPER_ADMIN_NAV].find(item => item.to === to)?.group
}

export function canAccessNavItem(item: AdminNavItem, access: { role: Role | null; isSuperAdmin: boolean; hostingPlatform?: boolean; shop?: boolean } | null | undefined): boolean {
  if (!isTeamRole(access?.role) && !access?.isSuperAdmin) return false
  if (item.hostingOnly && !access?.hostingPlatform) return false
  if (item.shopOnly && !access?.shop) return false
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
