import { userSiteRoles } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { useDb } from './db'
import type { Db } from './db'

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

export async function requireAuth(event: H3Event): Promise<{ userId: string; role: Role }> {
  const session = await requireSession(event)

  const siteId = event.context.siteId
  if (!siteId) throw badRequest('Unknown site')

  const db = useDb(event)
  const roleRow = await db.query.userSiteRoles.findFirst({
    where: and(eq(userSiteRoles.userId, session.user.id), eq(userSiteRoles.siteId, siteId)),
  })

  if (roleRow) return { userId: session.user.id, role: roleRow.role as Role }

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
  if (await hasSuperAdminRole(db, session.user.id)) {
    return { userId: session.user.id, role: 'viewer' }
  }

  throw forbidden('You do not have access to this site')
}

export async function requireRole(event: H3Event, minimum: Role) {
  const { userId, role } = await requireAuth(event)
  if (!roleAtLeast(role, minimum)) forbidden()
  return { userId, role }
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

export async function requireSuperAdmin(event: H3Event): Promise<{ userId: string }> {
  const session = await requireSession(event)
  const db = useDb(event)

  if (!(await hasSuperAdminRole(db, session.user.id))) {
    forbidden('Super admin required')
  }
  return { userId: session.user.id }
}
