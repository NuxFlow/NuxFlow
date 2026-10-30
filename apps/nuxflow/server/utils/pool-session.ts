import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { sessions, userSiteRoles, users } from '@nuxflow/db/schema'
import { useDb, type Db } from './db'
import { getPoolId } from './control-plane'
import { POOL_PROTOCOL } from './pool-admin'
import { clearCachedRole } from './role-cache'
import { randomToken } from '../../shared/lib/base64'
import { activatePendingInvitations } from './invitations'
import type { PoolSignInGrant, PoolSignInUser, SessionStatus } from './pool-sign-in'
import type { AccountProvisioningStatus } from './user-provisioning'
import type { EmailDeliveryOutcome } from './email'
import { withTimeout } from './timeout'
import { httpError } from './response'
import { getCfEnv } from './cf-env'

/**
 * A member pool's side of signing in (the control plane's is pool-sign-in.ts). Accounts and
 * sign-in sessions live only on the control plane; the pool reaches it over its private
 * `CONTROL_PLANE` service binding and keeps, in its own D1:
 *
 * - a copy of each signed-in person (`users`, same id) — authors, comments and roles
 *   point at a users row;
 * - a stand-in for the sign-in their site session hangs off (`sessions`, same id, with a
 *   random token nothing ever accepts: Better Auth never runs in a pool) — so ending it
 *   here still cascades to the site sessions, exactly as on the control plane.
 *
 * Whether that sign-in is still valid is asked of the control plane at most once a
 * minute per session (parentSessionAlive), so a sign-out, password reset or deleted
 * account anywhere reaches this pool within a minute.
 */

interface ControlPlaneStub {
  redeemSignInCode(input: { protocol: number; poolId: string; code: string; siteId: string; redirectUri: string }): Promise<PoolSignInGrant | null>
  sessionStatus(input: { protocol: number; parentSessionId: string; userId: string; extendTo?: string }): Promise<SessionStatus>
  endSession(input: { protocol: number; parentSessionId: string; userId: string }): Promise<{ ended: boolean }>
  // Inviting people to a pool's site (user-provisioning.ts): accounts are made, and
  // set-password emails sent, by the control plane.
  provisionAccount(input: { protocol: number; poolId: string; siteId: string; name: string; email: string }): Promise<{ user: PoolSignInUser; status: AccountProvisioningStatus }>
  sendSetPasswordEmail(input: { protocol: number; poolId: string; siteId: string; email: string; purpose: 'invite' | 'reset' }): Promise<{ emailDelivery: EmailDeliveryOutcome }>
}

/** A call to the control plane over this pool's CONTROL_PLANE binding, with a timeout. */
export function callControlPlane<T>(event: H3Event, call: (cp: ControlPlaneStub) => Promise<T>): Promise<T> {
  return controlPlaneCall(call(controlPlane(event)))
}

function controlPlane(event: H3Event): ControlPlaneStub {
  const stub = getCfEnv(event)?.CONTROL_PLANE
  if (!stub || typeof stub !== 'object') {
    throw httpError({ status: 503, message: 'Signing in is unavailable: this pool has no CONTROL_PLANE binding to its control panel.' })
  }
  return stub as ControlPlaneStub
}

const CALL_TIMEOUT_MS = 10_000

function controlPlaneCall<T>(promise: Promise<T>): Promise<T> {
  return withTimeout(promise, CALL_TIMEOUT_MS, `The control panel didn't answer within ${CALL_TIMEOUT_MS / 1000} s`)
}

// ── Sign-in ───────────────────────────────────────────────────────────────────────────

/**
 * Step 3 of site sign-in in a pool: hands the one-time code to the control plane, which
 * uses it up, and sets up this pool's copies. Null when the code is refused.
 */
export async function signInThroughControlPlane(event: H3Event, input: { code: string; siteId: string; redirectUri: string }): Promise<{ userId: string; parentSessionId: string } | null> {
  const grant = await controlPlaneCall(controlPlane(event).redeemSignInCode({ protocol: POOL_PROTOCOL, poolId: getPoolId()!, ...input }))
  if (!grant) return null
  const db = useDb(event)
  await upsertUserCopy(db, grant.user)
  await db.insert(sessions).values({
    id: grant.parentSessionId,
    token: `pool-standin:${randomToken()}`,
    userId: grant.user.id,
    expiresAt: grant.parentExpiresAt,
  }).onConflictDoUpdate({ target: sessions.id, set: { expiresAt: grant.parentExpiresAt, updatedAt: sql`(datetime('now'))` } })
  await syncPlatformSuperAdmin(db, grant.user.id, input.siteId, grant.platformSuperAdmin)
  // An invitation held for an account nobody had proven they own (invitations.ts) becomes
  // a real role once the control plane says the address is verified — on the control
  // plane that happens as the password reset completes; here, at the next sign-in.
  if (grant.user.emailVerified) {
    for (const siteId of await activatePendingInvitations(db, grant.user.id)) clearCachedRole(grant.user.id, siteId)
  }
  remember(grant.parentSessionId, true)
  return { userId: grant.user.id, parentSessionId: grant.parentSessionId }
}

/** This pool's copy of a person, refreshed from the control plane on every sign-in. */
export async function upsertUserCopy(db: Db, user: PoolSignInUser): Promise<void> {
  const fields = { name: user.name, email: user.email.toLowerCase(), emailVerified: user.emailVerified, image: user.image }
  await db.insert(users).values({ id: user.id, ...fields })
    .onConflictDoUpdate({ target: users.id, set: { ...fields, updatedAt: sql`(datetime('now'))` } })
}

/**
 * The platform's super admin (super admin of the control plane's primary site) is super
 * admin on this pool's sites too — where they have no other role. That's the only way a
 * super_admin role exists in a pool (setup and the grant route are refused here), so
 * signing in without the platform role takes it away again.
 */
async function syncPlatformSuperAdmin(db: Db, userId: string, siteId: string, isPlatformSuperAdmin: boolean): Promise<void> {
  if (isPlatformSuperAdmin) {
    await db.insert(userSiteRoles).values({ id: ulid(), userId, siteId, role: 'super_admin' }).onConflictDoNothing()
  } else {
    await db.delete(userSiteRoles).where(and(eq(userSiteRoles.userId, userId), eq(userSiteRoles.role, 'super_admin')))
  }
  clearCachedRole(userId, siteId)
}

// ── Is the sign-in still valid? ───────────────────────────────────────────────────────

// Per isolate: parent session id → when the control plane last said it was valid.
const alive = new Map<string, number>()
const RECHECK_MS = 60_000
// If the control plane can't be reached, a session it vouched for this recently stays
// usable — a short outage there shouldn't sign every pool's editors out.
const OUTAGE_GRACE_MS = 10 * 60_000
const MAX_REMEMBERED = 10_000

function remember(parentSessionId: string, isAlive: boolean): void {
  if (!isAlive) {
    alive.delete(parentSessionId)
    return
  }
  if (alive.size >= MAX_REMEMBERED) alive.delete(alive.keys().next().value!)
  alive.set(parentSessionId, Date.now())
}

/**
 * Whether the sign-in behind a site session in this pool is still valid. With `extendTo`
 * (the site session's daily slide) it always asks, and the control plane slides the
 * sign-in too. When it's gone, this pool's stand-in is deleted, which ends every site
 * session that hung off it.
 */
export async function parentSessionAlive(event: H3Event, input: { parentSessionId: string; userId: string; extendTo?: string }): Promise<boolean> {
  const checkedAt = alive.get(input.parentSessionId)
  if (!input.extendTo && checkedAt && Date.now() - checkedAt < RECHECK_MS) return true

  let status: SessionStatus
  try {
    status = await controlPlaneCall(controlPlane(event).sessionStatus({ protocol: POOL_PROTOCOL, ...input }))
  } catch (err) {
    console.error('[pool-session] Couldn\'t check a sign-in with the control panel:', err)
    return !!checkedAt && Date.now() - checkedAt < OUTAGE_GRACE_MS
  }
  if (!status.alive) {
    remember(input.parentSessionId, false)
    await useDb(event).delete(sessions).where(eq(sessions.id, input.parentSessionId))
    return false
  }
  remember(input.parentSessionId, true)
  return true
}

/** "Sign out" on a pool site: ends the sign-in on the control plane (every site), then here. */
export async function endParentSession(event: H3Event, parentSessionId: string): Promise<void> {
  const db = useDb(event)
  const [row] = await db.select({ userId: sessions.userId }).from(sessions).where(eq(sessions.id, parentSessionId)).limit(1)
  remember(parentSessionId, false)
  if (row) {
    try {
      await controlPlaneCall(controlPlane(event).endSession({ protocol: POOL_PROTOCOL, parentSessionId, userId: row.userId }))
    } catch (err) {
      // Still signed out here; the control plane's sign-in lapses on its own, and every
      // other pool stops honouring it once it does.
      console.error('[pool-session] Couldn\'t end a sign-in on the control panel:', err)
    }
  }
  // Cascades to every site session in this pool that hung off it.
  await db.delete(sessions).where(eq(sessions.id, parentSessionId))
}

/** Test hook. */
export function resetPoolSessionState(): void {
  alive.clear()
}
