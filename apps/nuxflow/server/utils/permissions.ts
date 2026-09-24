import { userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from './db'
import type { Db } from './db'
import { getCachedRole, setCachedRole } from './role-cache'

export type Role = 'super_admin' | 'admin' | 'editor' | 'author' | 'viewer' | 'member'

const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  admin: 80,
  editor: 60,
  author: 40,
  member: 20,
  viewer: 10,
}

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}

// The only scopes an API key can declare — see api-keys/index.post.ts. A key's own
// declared scopes are a ceiling on top of (never a substitute for) the issuing user's
// site role: 03.api-key-auth.ts sets event.context.apiKeyScopes from the authenticated
// key's row, and requireApiKeyScope below is the one real enforcement point for it.
export const API_KEY_SCOPES = ['read:content', 'write:content'] as const
export type ApiKeyScope = typeof API_KEY_SCOPES[number]

/**
 * True when the current request was authenticated via an API key (03.api-key-auth.ts)
 * whose own declared scopes include `scope`. Session-authenticated requests have no
 * scope concept — the caller's site role is the only gate for those — so this is only
 * meaningful for routes that are exclusively API-key-driven (mcp.ts) or that branch on
 * `event.context.apiKeyUserId` being present.
 */
export function hasApiKeyScope(event: H3Event, scope: ApiKeyScope): boolean {
  const scopes = event.context.apiKeyScopes as string[] | undefined
  return Boolean(scopes?.includes(scope))
}

// Statuses an author may still change their own item in. Once an editor has published,
// scheduled, or archived it, the item is out of the author's hands — otherwise an author
// could rewrite live content (or flip its access gate) without ever holding the editor
// role that publishing requires.
const AUTHOR_EDITABLE_STATUSES = new Set(['draft', 'review'])

// The only statuses an author may move an item INTO (publishing, scheduling, and
// archiving are editorial decisions).
export const AUTHOR_SETTABLE_STATUSES: ReadonlySet<string> = AUTHOR_EDITABLE_STATUSES

/**
 * The content-editing rule every write path shares (standard CMS author model): editor
 * and above can edit any item; an author can edit only items they wrote, and only while
 * those are unpublished (draft or in review). Anything below author can't edit at all.
 */
export function canEditContentItem(role: Role, userId: string, item: { authorId: string | null; status: string }): boolean {
  if (roleAtLeast(role, 'editor')) return true
  if (!roleAtLeast(role, 'author')) return false
  return item.authorId === userId && AUTHOR_EDITABLE_STATUSES.has(item.status)
}

export function assertCanEditContentItem(role: Role, userId: string, item: { authorId: string | null; status: string }): void {
  if (!canEditContentItem(role, userId, item)) {
    throw forbidden(item.authorId === userId
      ? 'This item has been published or scheduled — only an editor can change it now'
      : 'Authors can only edit their own content')
  }
}

export async function requireAuth(event: H3Event): Promise<{ userId: string; role: Role }> {
  const session = await requireSession(event)

  const siteId = event.context.siteId
  if (!siteId) throw badRequest('Unknown site')

  // Short-TTL isolate cache (see role-cache.ts for why 10s and not the usual 30-60s):
  // this lookup otherwise costs a fresh D1 round trip on every single authenticated
  // API call, unlike the site-domain lookup in 02.multi-site.ts.
  let cachedRole = getCachedRole(session.user.id, siteId)
  if (cachedRole === undefined) {
    const db = useDb(event)
    const roleRow = await db.query.userSiteRoles.findFirst({
      where: and(eq(userSiteRoles.userId, session.user.id), eq(userSiteRoles.siteId, siteId)),
    })
    cachedRole = (roleRow?.role as Role) ?? null
    setCachedRole(session.user.id, siteId, cachedRole)
  }

  if (cachedRole) return { userId: session.user.id, role: cachedRole }

  // No explicit relationship to this site. A super admin still gets read-only
  // 'viewer' access here — matches requireSuperAdmin's documented cross-site model
  // (super admin access to another site's admin panel is automatic, but their
  // effective role for content OPERATIONS there stays 'viewer' unless a real
  // user_site_roles row exists — see the module doc in CLAUDE.md). Anyone else has
  // never been invited to or registered on this site and must be rejected outright:
  // user accounts are global across this multi-tenant install (users/accounts carry
  // no siteId) and login has no site-membership check, so silently defaulting a
  // stranger to 'viewer' here would let a user invited to ANY other site — or
  // self-registered somewhere with public registration enabled — read this site's
  // admin-only data too (drafts, private/members-only content, media library, etc.).
  if (await hasSuperAdminRole(useDb(event), session.user.id)) {
    return { userId: session.user.id, role: 'viewer' }
  }

  throw forbidden('You do not have access to this site')
}

export async function requireRole(event: H3Event, minimum: Role) {
  const { userId, role } = await requireAuth(event)
  if (!roleAtLeast(role, minimum)) throw forbidden()
  return { userId, role }
}

/**
 * Non-throwing counterpart to requireAuth() — true when the caller is a real
 * member of the current site (has a user_site_roles row) or a super admin,
 * false for everything else, including "no session at all." Several routes
 * need this as a boolean to branch on (show published-only vs. everything,
 * auto-approve a comment vs. hold it for moderation, expose moderation-only
 * fields, etc.) rather than a hard 401/403 — the request itself is often a
 * perfectly legitimate anonymous/guest one, just with reduced visibility.
 * Deliberately implemented as a thin wrapper around requireAuth() rather than
 * re-querying user_site_roles/hasSuperAdminRole directly, so the cross-tenant
 * membership check has exactly one implementation to keep correct (see
 * requireAuth's own doc comment for the leak this closes).
 */
export async function isSiteMember(event: H3Event): Promise<boolean> {
  try {
    await requireAuth(event)
    return true
  } catch {
    return false
  }
}

/**
 * Session-aware counterpart to isSiteMember() for callers that already hold a resolved
 * session from earlier in the same handler (e.g. an optional-auth check for guest vs.
 * logged-in behavior) — reuses it instead of paying for a second independent Better Auth
 * session lookup (requireAuth → requireSession → auth.api.getSession()) for the same
 * request. `session` may be null (no session at all), which is simply "not a member."
 * Mirrors requireAuth's own membership rule (a real user_site_roles row, or a super admin
 * on any site) without throwing.
 */
export async function isSiteMemberForSession(db: Db, session: { user: { id: string } } | null, siteId: string): Promise<boolean> {
  if (!session) return false
  const roleRow = await getUserSiteRole(db, session.user.id, siteId)
  if (roleRow) return true
  return hasSuperAdminRole(db, session.user.id)
}

export async function getUserSiteRole(db: Db, userId: string, siteId: string) {
  return db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.siteId, siteId)),
  })
}

export async function hasSuperAdminRole(db: Db, userId: string): Promise<boolean> {
  const roleRow = await db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.role, 'super_admin')),
    columns: { id: true },
  })
  return !!roleRow
}

// Shared by users/[id].patch.ts and users/[id].delete.ts (both site-role mutation
// routes): an acting admin must never be able to modify their own membership here —
// unlike removal there's no confirmation step, and an admin demoting/removing
// themselves (especially the site's last admin) has no recovery path short of a super
// admin stepping in from a different site.
export function assertNotSelfTarget(targetId: string, actingUserId: string, message: string): void {
  if (targetId === actingUserId) throw badRequest(message)
}

// Shared by the same two routes: a plain admin must never be able to touch a
// super_admin's access on this site (demote them via PATCH, or remove them via
// DELETE) — only the dedicated, requireSuperAdmin-gated routes may grant/revoke
// super_admin (see users/[id]/super-admin.*.ts).
export function assertTargetNotSuperAdmin(existingRole: string | undefined, message: string): void {
  if (existingRole === 'super_admin') throw forbidden(message)
}

/**
 * True when the user holds super_admin on this specific site. Platform-level actions are
 * only accepted on a domain where the caller actually holds that grant — see
 * requireSuperAdmin for why "super_admin on any site" is not enough there.
 */
export async function isSuperAdminOnSite(db: Db, userId: string, siteId: string | null | undefined): Promise<boolean> {
  if (!siteId) return false
  const roleRow = await getUserSiteRole(db, userId, siteId)
  return roleRow?.role === 'super_admin'
}

/**
 * Gate for platform-wide actions (every site, whole-database export, suspension,
 * granting super_admin). Requires a super_admin grant on the site whose domain the
 * request arrived on — not merely on some site.
 *
 * Site admins can run arbitrary script on their own public pages (custom head/body HTML
 * is a deliberate admin feature — see site-settings-resolver.ts). If a super admin
 * signed in on a tenant's domain opened one of those pages, that script could previously
 * call these endpoints with the super admin's session, since this check didn't care which
 * domain it came in on — letting any tenant admin escalate to platform control. Pinning
 * the check to the current site confines platform actions to domains where the operator
 * explicitly holds super_admin (normally the primary site created by the first install).
 */
export async function requireSuperAdmin(event: H3Event): Promise<{ userId: string }> {
  const session = await requireSession(event)
  const db = useDb(event)

  if (!(await isSuperAdminOnSite(db, session.user.id, event.context.siteId as string | undefined))) {
    throw forbidden('Super admin required')
  }
  return { userId: session.user.id }
}
