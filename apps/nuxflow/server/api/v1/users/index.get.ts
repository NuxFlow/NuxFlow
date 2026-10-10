import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { userSiteRoles, sessions, siteInvitations } from '@nuxflow/db/schema'
import { eq, inArray } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const roles = await db.query.userSiteRoles.findMany({
    where: eq(userSiteRoles.siteId, siteId),
    with: { user: { columns: { id: true, name: true, email: true, image: true, createdAt: true, emailVerified: true } } },
    limit: 1000,
  })

  const userRows = roles.filter(r => r.user)

  // Invitations to unclaimed accounts that haven't been accepted yet — no role row
  // exists for these until the invitee sets their password (see site_invitations).
  const invitations = await db.query.siteInvitations.findMany({
    where: eq(siteInvitations.siteId, siteId),
    with: { user: { columns: { id: true, name: true, email: true, image: true, createdAt: true } } },
    limit: 1000,
  })

  // "Pending" == invited but never accepted: either a pending invitation above, or a member
  // who has neither a session nor a verified email. Sessions alone weren't enough — signing
  // out deletes the session row, so a member who had signed out showed as "Pending" again.
  // Accepting an invite (setting a password from the emailed link) verifies the email.
  const everLoggedIn = userRows.length > 0
    ? new Set(
        (await db.query.sessions.findMany({
          where: inArray(sessions.userId, userRows.map(r => r.user!.id)),
          columns: { userId: true },
        })).map(s => s.userId),
      )
    : new Set<string>()

  type UserRow = { id: string; name: string; email: string; image: string | null; createdAt: string }
  return {
    users: [
      ...userRows.map((r) => {
        const { emailVerified, ...user } = r.user!
        return { ...(user as UserRow), role: r.role, pending: !everLoggedIn.has(user.id) && !emailVerified }
      }),
      ...invitations.filter(i => i.user).map(i => ({
        ...(i.user as UserRow),
        role: i.role,
        pending: true,
        invitationExpiresAt: i.expiresAt,
      })),
    ],
  }
})
