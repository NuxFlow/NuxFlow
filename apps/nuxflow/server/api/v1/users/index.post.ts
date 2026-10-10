import { z } from 'zod'
import { pendingInvitationInsert } from '../../../utils/invitations'
import { useDb } from '../../../utils/db'
import { userSiteRoles, sites } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'
import { requireRole, getUserSiteRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { sendTemplatedEmail } from '../../../utils/email-template'
import { emailLogTimestamp, lastEmailOutcome } from '../../../utils/email'
import { rateLimit } from '../../../utils/rate-limit'
import { created } from '../../../utils/response'
import { findOrCreateUserAccount, sendSetPasswordEmail } from '../../../utils/user-provisioning'
import { clearCachedRole } from '../../../utils/role-cache'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  role: z.enum(['admin', 'editor', 'author', 'viewer', 'member']).default('viewer'),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'user-invite' })
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!

  const body = await parseBody(event, bodySchema)

  const db = useDb(event)

  const { userId: newUserId, status } = await findOrCreateUserAccount(event, { name: body.name, email: body.email })

  if (status !== 'new') {
    // Check they aren't already a member of this site
    const alreadyMember = await getUserSiteRole(db, newUserId, siteId)
    if (alreadyMember) {
      throw conflict('This user is already a member of this site')
    }
  }

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'invite',
    resource: 'user',
    resourceId: newUserId,
    after: { role: body.role, email: body.email, ...(status === 'unclaimed' && { pending: true }) },
  })

  // An account nobody has proven they own (see isUnclaimedAccount) could have been
  // pre-registered by someone else specifically to catch this invite — so it gets no role
  // yet. The role is held as a pending invitation and granted only when whoever controls
  // the mailbox completes the set-password link emailed below. The account itself is left
  // untouched: it may be a real person's account on another site, and inviting their
  // address must never lock them out of it.
  if (status === 'unclaimed') {
    await batchWithAudit(db, [pendingInvitationInsert(db, { siteId, userId: newUserId, role: body.role, invitedBy: userId })], auditInsert)
    const since = emailLogTimestamp()
    await sendSetPasswordEmail(event, body.email.toLowerCase(), siteId)
    const emailDelivery = await lastEmailOutcome(event, siteId, body.email, since)
    return created(event, { id: newUserId, name: body.name, email: body.email, role: body.role, pending: true, emailDelivery })
  }

  // onConflictDoNothing: the alreadyMember check above closes the common case, but two
  // concurrent invites for the same not-yet-member (email, site) pair could both pass
  // that check before either insert runs — the unique index on (user_id, site_id) is the
  // real guard against duplicate role rows; this just makes the loser of that race a
  // silent no-op instead of a raw SQLITE_CONSTRAINT error, mirroring the same pattern
  // register.post.ts already uses for its own self-registration insert.
  const roleInsert = db.insert(userSiteRoles).values({
    id: ulid(),
    userId: newUserId,
    siteId,
    role: body.role,
  }).onConflictDoNothing()
  await batchWithAudit(db, [roleInsert], auditInsert)
  clearCachedRole(newUserId, siteId)

  // The role is granted either way; the response also says whether the email went out, so
  // the admin isn't told "invited" for an invite nobody receives (see lastEmailOutcome).
  const since = emailLogTimestamp()
  if (status === 'new') {
    // A brand-new invitee has no password they can actually use (findOrCreateUserAccount
    // gives it an unusable random one) — sending them a "sign in" email would be a dead
    // end. The set-password link is the ONE email a new invitee receives; it's worded as
    // an invitation to this site and returns them here once their password is set.
    await sendSetPasswordEmail(event, body.email.toLowerCase(), siteId)
  }
  else {
    // Existing user already has working credentials for their account — being
    // added to this site just needs a pointer to sign in.
    const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true, domain: true } })
    const siteName = site?.name ?? 'NuxFlow'
    await sendTemplatedEmail(event, {
      to: body.email,
      subject: `You've been added to ${siteName}`,
      category: 'invite',
      template: {
        heading: `You've been added to ${siteName}`,
        paragraphs: [`Hi ${body.name},`, `You now have ${body.role} access to ${siteName}. Sign in with your existing account to get started.`],
        action: { label: 'Sign in', url: `https://${site?.domain ?? 'nuxflow.app'}/admin` },
      },
    }).catch(err => console.error('[invite] Email delivery failed:', err))
  }

  const emailDelivery = await lastEmailOutcome(event, siteId, body.email, since)
  return created(event, { id: newUserId, name: body.name, email: body.email, role: body.role, emailDelivery })
})
