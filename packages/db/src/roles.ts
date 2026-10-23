// The site role model, defined once. Deliberately free of imports so it's safe in the
// browser bundle as well as the Worker: the schema enums, the server's permission checks
// and the admin UI all read it (`@nuxflow/db/roles`).

/** Every role a `user_site_roles` row can hold. */
export const ROLES = ['super_admin', 'admin', 'editor', 'author', 'viewer', 'member'] as const
export type Role = typeof ROLES[number]

/**
 * Roles a site admin can give someone (invite, role change, backup restore). `super_admin`
 * is platform-wide and only granted deliberately by another super admin.
 */
export const ASSIGNABLE_ROLES = ['admin', 'editor', 'author', 'viewer', 'member'] as const
export type AssignableRole = typeof ASSIGNABLE_ROLES[number]

/**
 * Roles an account can hold without anyone having vouched for it: self-registration grants
 * 'member' to an address whose owner has never clicked anything. Any higher role was
 * granted by a site admin or the setup wizard.
 */
export const SELF_SERVE_ROLES = ['member', 'viewer'] as const

const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  admin: 80,
  editor: 60,
  author: 40,
  member: 20,
  viewer: 10,
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  editor: 'Editor',
  author: 'Author',
  viewer: 'Viewer',
  member: 'Member',
}

/** False for no role at all. Never use this alone to decide admin access — see isTeamRole(). */
export function roleAtLeast(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

/**
 * True for roles that belong to the site's team (viewer and up). `member` is a site
 * visitor — someone who registered publicly, joined through the accounts origin, or holds
 * a membership — and ranks above `viewer` only for historical reasons, so never compare it
 * with roleAtLeast() to decide admin access.
 */
export function isTeamRole(role: Role | null | undefined): boolean {
  return !!role && role !== 'member'
}
