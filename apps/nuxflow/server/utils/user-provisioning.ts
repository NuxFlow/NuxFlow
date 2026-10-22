import type { H3Event } from 'h3'
import { useDb } from './db'
import type { Db } from './db'
import { getOrCreateBetterAuth } from './better-auth'
import { getPoolId, isMemberPool } from './control-plane'
import { POOL_PROTOCOL } from './pool-admin'
import { callControlPlane, upsertUserCopy } from './pool-session'
import { requireSiteId } from './site-context'
import type { EmailDeliveryOutcome } from './email'

/**
 * - `new`       — no account existed; one was just created, with no password yet.
 * - `existing`  — an account the invitee has demonstrably claimed already; safe to grant a
 *                 role to as-is.
 * - `unclaimed` — an account exists for this email, but nothing proves the person who
 *                 created it actually owns the mailbox (see isUnclaimedAccount below).
 *                 Callers must never grant it a role directly — record a pending
 *                 invitation (pendingInvitationInsert) instead.
 *
 * `new` and `unclaimed` both need the follow-up "set your password" email
 * (auth.api.requestPasswordReset()), which is the step that proves mailbox ownership.
 */
export type AccountProvisioningStatus = 'new' | 'existing' | 'unclaimed'

// Roles an account can hold without anyone having vouched for it: self-registration
// (api/public/auth/register.post.ts) grants 'member' to an address whose owner has never
// clicked anything. Any higher role was granted by a site admin or the setup wizard.
const SELF_SERVE_ROLES = ['member', 'viewer'] as const

/**
 * True when an account exists for an email but nothing shows its creator controls that
 * mailbox: the address was never verified AND the account has never been granted any
 * staff role on any site. This is exactly the shape of a pre-registered ("pre-hijacked")
 * account — someone signs up with a colleague's address before the colleague is invited,
 * sets a password they know, and waits for an admin's invite to attach a real role to it.
 *
 * Any role above member/viewer counts as proof, so long-standing team accounts created
 * before email verification existed (every such row still has emailVerified = false) are
 * never disturbed by being invited to another site.
 */
export async function isUnclaimedAccount(db: Db, userId: string, emailVerified: boolean): Promise<boolean> {
  if (emailVerified) return false
  const staffRole = await db.query.userSiteRoles.findFirst({
    where: (r, { and, eq, notInArray }) => and(eq(r.userId, userId), notInArray(r.role, [...SELF_SERVE_ROLES])),
    columns: { id: true },
  })
  return !staffRole
}

// Creates a user account if one doesn't already exist for this email. Callers are
// expected to follow up with auth.api.requestPasswordReset() to give the person a real,
// working way in (see server/api/v1/users/index.post.ts's own comment on why that's the
// *only* email a brand-new account should get, not a separate dead-end "you've been
// invited" email). Shared by the invite flow and per-site backup restore
// (server/utils/backup.ts), which both need "find this email, or create a fresh account
// for it" — restoring a backup onto a brand-new deployment means none of the original
// site's users exist there yet, so restore has the exact same provisioning need invite does.
//
// The account is created through Better Auth's internal adapter with no password at all,
// rather than through signUpEmail() with a random throwaway one: hashing that throwaway
// password cost ~170 ms of Argon2 CPU per account (a restore can create up to 500), for a
// password nobody ever learns. Nothing is lost — with no credential account, email/password
// sign-in simply fails, and Better Auth's reset-password creates the credential account
// when the person sets their real password. No session is created either.
//
// Never mutates an existing account.
//
// In a member pool (control-plane.ts) accounts live on the control plane, so it makes the
// account and the pool keeps its copy of the person.
export async function findOrCreateUserAccount(
  event: H3Event,
  input: { name: string; email: string },
): Promise<{ userId: string; status: AccountProvisioningStatus }> {
  if (!isMemberPool()) return findOrCreateLocalAccount(event, input)
  const db = useDb(event)
  const { user, status } = await callControlPlane(event, cp => cp.provisionAccount({
    protocol: POOL_PROTOCOL, poolId: getPoolId()!, siteId: requireSiteId(event), ...input,
  }))
  await upsertUserCopy(db, user)
  // The control plane only sees roles on its own sites; a staff role in this pool vouches
  // for the account just the same.
  if (status === 'unclaimed' && !(await isUnclaimedAccount(db, user.id, user.emailVerified))) {
    return { userId: user.id, status: 'existing' }
  }
  return { userId: user.id, status }
}

/** findOrCreateUserAccount() against this Worker's own accounts — the control plane's. */
export async function findOrCreateLocalAccount(
  event: H3Event,
  { name, email }: { name: string; email: string },
): Promise<{ userId: string; status: AccountProvisioningStatus }> {
  // Better Auth's own sign-up endpoint normalizes email to lowercase before inserting
  // (see register.post.ts, which already lowercases for this exact reason) — matching
  // that here up front means both lookups below actually find the row it creates,
  // instead of 500ing on any invitee email containing an uppercase letter.
  const normalizedEmail = email.toLowerCase()
  const db = useDb(event)
  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, normalizedEmail),
    columns: { id: true, emailVerified: true },
  })
  if (existing) {
    const unclaimed = await isUnclaimedAccount(db, existing.id, existing.emailVerified)
    return { userId: existing.id, status: unclaimed ? 'unclaimed' : 'existing' }
  }

  const auth = await getOrCreateBetterAuth(event)
  const { internalAdapter } = await auth.$context
  const created = await internalAdapter.createUser({ name, email: normalizedEmail, emailVerified: false }, { method: 'email-password' })
  if (!created) throw createError({ statusCode: 500, message: 'Failed to create user account' })
  return { userId: created.id, status: 'new' }
}

/**
 * Emails a single-use set-password link (Better Auth's password-reset token) — the one way
 * an invitee proves they control the mailbox. `siteId` is carried on the link's callback
 * URL so the email is branded for, and the finished flow returns to, the inviting site
 * (see sendResetPassword in better-auth.ts). Never throws: a failed send is logged and the
 * admin can use "Resend invite".
 *
 * In a member pool the control plane sends it (it runs sign-in) and returns how the send
 * went, since it's logged there; elsewhere it returns null and callers read the email log.
 */
export async function sendSetPasswordEmail(event: H3Event, email: string, siteId: string, purpose: 'invite' | 'reset' = 'invite'): Promise<EmailDeliveryOutcome | null> {
  if (isMemberPool()) {
    try {
      const { emailDelivery } = await callControlPlane(event, cp => cp.sendSetPasswordEmail({ protocol: POOL_PROTOCOL, poolId: getPoolId()!, siteId, email, purpose }))
      return emailDelivery
    } catch (err) {
      console.error('[user-provisioning] The control panel couldn\'t send a set-password email:', err)
      return { sent: false, reason: 'The control panel couldn\'t be reached to send it.' }
    }
  }
  await sendLocalSetPasswordEmail(event, email, siteId, purpose)
  return null
}

/** sendSetPasswordEmail() through this Worker's own Better Auth — the control plane's. */
export async function sendLocalSetPasswordEmail(event: H3Event, email: string, siteId: string, purpose: 'invite' | 'reset' = 'invite'): Promise<void> {
  try {
    const auth = await getOrCreateBetterAuth(event)
    const params = new URLSearchParams({ site: siteId, purpose })
    await auth.api.requestPasswordReset({ body: { email, redirectTo: `/reset-password?${params}` } })
  } catch (err) {
    console.error('[user-provisioning] Failed to send set-password email:', err)
  }
}
