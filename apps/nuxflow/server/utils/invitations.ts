import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { siteInvitations, userSiteRoles } from '@nuxflow/db/schema'
import type { Db } from './db'

// How long a pending invitation (see site_invitations in packages/db/src/schema/users.ts)
// waits for its set-password link to be used.
export const INVITATION_TTL_DAYS = 14

/**
 * Records a role for an *unclaimed* account (see isUnclaimedAccount) without granting it:
 * the role is only written once whoever controls the mailbox completes the emailed
 * set-password link — see activatePendingInvitations(). Nothing about the account itself
 * changes here. (An earlier version "reclaimed" the account on the spot — revoking every
 * session, deleting passkeys, scrambling the password — which let any tenant admin lock
 * out a member of any other site just by inviting their address.)
 *
 * Re-inviting refreshes the role and expiry rather than failing. Returns the unexecuted
 * statement so it can share a batch with its audit row.
 */
export function pendingInvitationInsert(
  db: Db,
  inv: { siteId: string; userId: string; role: 'admin' | 'editor' | 'author' | 'viewer' | 'member'; invitedBy: string | null },
) {
  // Deliberately NOT async: Drizzle query builders are thenables, and returning one from an
  // async function would execute it — callers fold this into a db.batch() instead.
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString()
  return db.insert(siteInvitations)
    .values({ id: ulid(), ...inv, expiresAt })
    .onConflictDoUpdate({
      target: [siteInvitations.siteId, siteInvitations.userId],
      set: { role: inv.role, invitedBy: inv.invitedBy, expiresAt },
    })
}

/**
 * Turns a user's unexpired pending invitations into real site roles. Called when they
 * complete a password reset — the one step that proves they control the mailbox *and*
 * replaces whatever password a pre-registering party may have set (Better Auth revokes
 * every session on reset too, and onPasswordReset drops passkeys for an unverified
 * account). Returns the site ids that gained a role.
 */
export async function activatePendingInvitations(db: Db, userId: string): Promise<string[]> {
  const now = new Date().toISOString()
  const pending = await db.query.siteInvitations.findMany({
    where: (i, { and, eq, gt }) => and(eq(i.userId, userId), gt(i.expiresAt, now)),
  })
  for (const inv of pending) {
    await db.insert(userSiteRoles)
      .values({ id: ulid(), userId, siteId: inv.siteId, role: inv.role })
      .onConflictDoNothing()
  }
  await db.delete(siteInvitations).where(eq(siteInvitations.userId, userId))
  return pending.map(i => i.siteId)
}
