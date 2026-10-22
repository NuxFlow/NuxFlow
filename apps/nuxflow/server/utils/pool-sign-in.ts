import { and, eq, gt, sql } from 'drizzle-orm'
import { sessions, siteDirectory, sites, users } from '@nuxflow/db/schema'
import type { Db } from './db'
import { consumeSiteAuthCode } from './site-auth'
import { isSuperAdminOnSite } from './permissions'
import { assertCompatibleProtocol } from './pool-admin'

/**
 * The control plane's side of signing in to sites in member pools (control-plane.ts).
 * Accounts and sign-in sessions exist only here, so a pool asks — over its private
 * `NuxflowControlPlane` service binding (server/pool-host/control-plane-entrypoint.ts) —
 * instead of reading this database:
 *
 * - redeemSignInCode(): the site sign-in handoff's one-time code (site-auth.ts) is used up
 *   here, exactly as for the control plane's own sites, and the pool gets who it was for.
 * - sessionStatus(): whether the sign-in a pool's site session hangs off is still valid.
 *   Pools ask at most once a minute per session, so signing out, a password reset or a
 *   deleted account reaches every pool within a minute — however the session ended.
 * - endSession(): "Sign out" on a pool site ends the sign-in here, for every site.
 */

export interface PoolSignInUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
}

export interface PoolSignInGrant {
  user: PoolSignInUser
  parentSessionId: string
  parentExpiresAt: string
  /** Super admin of the platform (the primary site) — a pool lets them act as one on its sites. */
  platformSuperAdmin: boolean
}

async function isPlatformSuperAdmin(db: Db, userId: string): Promise<boolean> {
  const [primary] = await db.select({ id: sites.id }).from(sites).where(eq(sites.isPrimary, true)).limit(1)
  return isSuperAdminOnSite(db, userId, primary?.id)
}

async function liveSession(db: Db, sessionId: string, userId: string) {
  const [row] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date().toISOString())))
    .limit(1)
  return row ?? null
}

export async function redeemSignInCode(db: Db, input: {
  protocol: number
  poolId: string
  code: string
  siteId: string
  redirectUri: string
}): Promise<PoolSignInGrant | null> {
  assertCompatibleProtocol(input.protocol)
  // Used up first, whatever happens next: a code is good for one attempt only.
  const grant = await consumeSiteAuthCode(db, input.code, input.siteId, input.redirectUri)
  if (!grant) return null
  // Only for a site the calling pool really serves, per the router's directory.
  const [listed] = await db.select({ hostname: siteDirectory.hostname }).from(siteDirectory)
    .where(and(eq(siteDirectory.poolId, input.poolId), eq(siteDirectory.poolSiteId, input.siteId)))
    .limit(1)
  if (!listed) return null
  const parent = await liveSession(db, grant.parentSessionId, grant.userId)
  if (!parent) return null
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email, emailVerified: users.emailVerified, image: users.image })
    .from(users).where(eq(users.id, grant.userId)).limit(1)
  if (!user) return null
  return {
    user: { ...user, image: user.image ?? null },
    parentSessionId: grant.parentSessionId,
    parentExpiresAt: String(parent.expiresAt),
    platformSuperAdmin: await isPlatformSuperAdmin(db, user.id),
  }
}

export interface SessionStatus {
  alive: boolean
  expiresAt: string | null
  platformSuperAdmin: boolean
}

/**
 * Whether a sign-in is still valid. With `extendTo`, also slides it to at least that
 * time, as a site session's daily refresh does on the control plane's own sites.
 */
export async function sessionStatus(db: Db, input: { protocol: number; parentSessionId: string; userId: string; extendTo?: string }): Promise<SessionStatus> {
  assertCompatibleProtocol(input.protocol)
  const parent = await liveSession(db, input.parentSessionId, input.userId)
  if (!parent) return { alive: false, expiresAt: null, platformSuperAdmin: false }
  let expiresAt = String(parent.expiresAt)
  if (input.extendTo && input.extendTo > expiresAt) {
    await db.update(sessions).set({ expiresAt: input.extendTo, updatedAt: sql`(datetime('now'))` })
      .where(and(eq(sessions.id, input.parentSessionId), eq(sessions.userId, input.userId)))
    expiresAt = input.extendTo
  }
  return { alive: true, expiresAt, platformSuperAdmin: await isPlatformSuperAdmin(db, input.userId) }
}

/** Ends a sign-in everywhere (every site session on every site hangs off it). */
export async function endSession(db: Db, input: { protocol: number; parentSessionId: string; userId: string }): Promise<{ ended: boolean }> {
  assertCompatibleProtocol(input.protocol)
  const deleted = await db.delete(sessions)
    .where(and(eq(sessions.id, input.parentSessionId), eq(sessions.userId, input.userId)))
    .returning({ id: sessions.id })
  return { ended: deleted.length > 0 }
}
