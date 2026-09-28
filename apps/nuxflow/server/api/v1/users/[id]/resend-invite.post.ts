import { useDb } from '../../../../utils/db'
import { pendingInvitationInsert } from '../../../../utils/invitations'
import { users, sessions, siteInvitations } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { requireRole, getUserSiteRole } from '../../../../utils/permissions'
import { rateLimit } from '../../../../utils/rate-limit'
import { writeAuditLog } from '../../../../utils/audit'
import { sendSetPasswordEmail } from '../../../../utils/user-provisioning'

// Re-sends the set-password email an invitee gets on first invite (see
// sendSetPasswordEmail in user-provisioning.ts) — for when the original link expired or
// the email never arrived. Only for someone still pending on this site: a pending
// invitation (an unclaimed account — see site_invitations), or a member who has never
// signed in. An admin can't use it to push password-reset emails at established members,
// which would just be a nuisance at best and a phishing lure at worst.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'user-resend-invite' })
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!
  const targetId = getRouterParam(event, 'id')!

  const db = useDb(event)

  const [membership, invitation] = await Promise.all([
    getUserSiteRole(db, targetId, siteId),
    db.query.siteInvitations.findFirst({
      where: and(eq(siteInvitations.userId, targetId), eq(siteInvitations.siteId, siteId)),
    }),
  ])
  if (!membership && !invitation) throw notFound('User not found in this site')

  if (membership) {
    const everSignedIn = await db.query.sessions.findFirst({ where: eq(sessions.userId, targetId), columns: { id: true } })
    if (everSignedIn) throw conflict('This user has already signed in — they can use "Forgot password" if they need to.')
  }

  const target = await db.query.users.findFirst({ where: eq(users.id, targetId), columns: { email: true } })
  if (!target) throw notFound('User not found')

  // A resend also restarts a pending invitation's expiry clock.
  if (invitation) {
    await pendingInvitationInsert(db, { siteId, userId: targetId, role: invitation.role, invitedBy: userId })
  }
  await sendSetPasswordEmail(event, target.email, siteId)

  await writeAuditLog(event, userId, { action: 'resend_invite', resource: 'user', resourceId: targetId })

  return { success: true }
})
