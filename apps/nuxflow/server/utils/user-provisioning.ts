import type { H3Event } from 'h3'
import { ulid } from 'ulid'
import { and, eq } from 'drizzle-orm'
import { accounts, passkeys, sessions } from '@nuxflow/db/schema'
import { useDb } from './db'
import type { Db } from './db'
import { getOrCreateBetterAuth } from './better-auth'
import { nuxflowPasswordHasher } from './pw'

/**
 * - `new`       — no account existed; one was just created with an unusable random password.
 * - `existing`  — an account the invitee has demonstrably claimed already; safe to grant a
 *                 role to as-is.
 * - `unclaimed` — an account exists for this email, but nothing proves the person who
 *                 created it actually owns the mailbox (see isUnclaimedAccount below).
 *                 Callers must call reclaimAccount() before granting it anything.
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

/**
 * Takes an unclaimed account away from whoever created it, so the real mailbox owner can
 * claim it through the set-password email: every session is revoked, every passkey is
 * removed (either could have been registered by the pre-registering party), and the
 * credential password is replaced with an unusable random one. Role rows and content are
 * untouched — the account itself is kept, only its ways in are reset.
 */
export async function reclaimAccount(event: H3Event, userId: string): Promise<void> {
  const db = useDb(event)
  const scrambled = await nuxflowPasswordHasher.hash(`${ulid()}${ulid()}`)
  await db.delete(sessions).where(eq(sessions.userId, userId))
  await db.delete(passkeys).where(eq(passkeys.userId, userId))
  await db.update(accounts)
    .set({ password: scrambled })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
}

// Creates a user account with an unusable random temp password if one doesn't already
// exist for this email, without ever sending that password anywhere — callers are
// expected to follow up with auth.api.requestPasswordReset() to give the person a real,
// working way in (see server/api/v1/users/index.post.ts's own comment on why that's the
// *only* email a brand-new account should get, not a separate dead-end "you've been
// invited" email). Shared by the invite flow and per-site backup restore
// (server/utils/backup.ts), which both need "find this email, or create a fresh account
// for it" — restoring a backup onto a brand-new deployment means none of the original
// site's users exist there yet, so restore has the exact same provisioning need invite does.
//
// Never mutates an existing account: an `unclaimed` result is only reclaimed once the
// caller has finished its own checks (e.g. "already a member of this site"), via
// reclaimAccount().
export async function findOrCreateUserAccount(
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
  const tempPassword = `${ulid()}${ulid()}`
  await auth.api.signUpEmail({ body: { name, email: normalizedEmail, password: tempPassword } })

  const created = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, normalizedEmail),
    columns: { id: true },
  })
  if (!created) throw createError({ statusCode: 500, message: 'Failed to create user account' })
  return { userId: created.id, status: 'new' }
}
