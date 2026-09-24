// ── Users & roles restore ─────────────────────────────────────────────────────
// Matched by email (the natural key — accounts are global, not per-site; see
// user-provisioning.ts). Restoring onto a brand-new deployment means none of the
// original site's users exist there yet, so this provisions a fresh account (same
// temp-password + "set your password" email pattern as a normal invite) for anyone
// not already found by email, then assigns them the backed-up role. Never restores
// 'super_admin' — buildBackup() already excludes it (see BackupUserRole), so this can
// only ever grant real roles, same restriction PATCH/POST /api/v1/users enforce.
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { userSiteRoles } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import type { Db } from '../db'
import { getOrCreateBetterAuth } from '../better-auth'
import { findOrCreateUserAccount, reclaimAccount } from '../user-provisioning'
import { RESTORABLE_ROLES } from '../backup-types'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

export async function restoreUsers(
  event: H3Event,
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('users') || !backup.users) return

  // One prefetch of this site's existing roles (joined to email) instead of one
  // getUserSiteRole() findFirst() per backup user. findOrCreateUserAccount() below still
  // does its own per-user account lookup/creation — that's global account provisioning
  // shared with the invite flow (accounts have no siteId), not the per-site matching key
  // this prefetch targets, so it isn't something a single inArray() could replace.
  const existingRoleRows = await db.query.userSiteRoles.findMany({
    where: eq(userSiteRoles.siteId, siteId),
    with: { user: { columns: { email: true } } },
  })
  const roleByEmail = new Map<string, { role: string }>()
  for (const r of existingRoleRows) {
    if (r.user) roleByEmail.set(r.user.email.toLowerCase(), { role: r.role })
  }

  for (const backupUser of backup.users) {
    // Second, redundant check on top of parseBackupJson()'s schema: applyBackup() is
    // also called from demo-import.post.ts and directly from tests with a plain object
    // literal, neither of which necessarily went through that schema — this is the one
    // check guaranteed to run no matter how the caller obtained `backup`.
    if (!(RESTORABLE_ROLES as readonly string[]).includes(backupUser.role)) {
      result.users.skipped++
      continue
    }

    const email = backupUser.email.toLowerCase()
    const { userId: targetUserId, status } = await findOrCreateUserAccount(event, {
      name: backupUser.name,
      email,
    })

    // Set once a role row is actually written for this account below — an unclaimed
    // account (see isUnclaimedAccount) must be reclaimed before it's granted anything.
    let roleWritten = false
    const existingRole = roleByEmail.get(email)
    if (existingRole) {
      if (opts.conflictMode === 'overwrite' && existingRole.role !== 'super_admin') {
        await db.update(userSiteRoles).set({ role: backupUser.role })
          .where(and(eq(userSiteRoles.userId, targetUserId), eq(userSiteRoles.siteId, siteId)))
        result.users.updated++
        roleWritten = true
        roleByEmail.set(email, { role: backupUser.role })
      } else {
        result.users.skipped++
      }
    } else {
      await db.insert(userSiteRoles).values({ id: ulid(), userId: targetUserId, siteId, role: backupUser.role })
      result.users.created++
      roleWritten = true
      // Handles a duplicate email within the same backup.json (hand-edited — a real
      // export can't produce one): the second entry now sees the role the first entry
      // just created instead of trying to insert a second row for the same
      // (userId, siteId) pair.
      roleByEmail.set(email, { role: backupUser.role })
    }

    if (status === 'unclaimed' && roleWritten) {
      await reclaimAccount(event, targetUserId)
    }

    if (status === 'new' || (status === 'unclaimed' && roleWritten)) {
      try {
        const auth = await getOrCreateBetterAuth(event)
        await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } })
      } catch (err) {
        console.error('[restore] Failed to send set-password email:', err)
      }
    }
  }
}
