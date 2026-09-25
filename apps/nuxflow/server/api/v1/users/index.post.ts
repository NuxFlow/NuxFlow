import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { userSiteRoles, sites } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'
import { requireRole, getUserSiteRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { sendTemplatedEmail } from '../../../utils/email-template'
import { waitUntil } from '../../../utils/cf-env'
import { rateLimit } from '../../../utils/rate-limit'
import { created } from '../../../utils/response'
import { getOrCreateBetterAuth } from '../../../utils/better-auth'
import { findOrCreateUserAccount, reclaimAccount } from '../../../utils/user-provisioning'
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

  // An account nobody has proven they own (see isUnclaimedAccount) could have been
  // pre-registered by someone else specifically to catch this invite. Reset its ways in
  // before attaching the role, then treat it exactly like a brand-new invitee below: the
  // set-password email goes to the real mailbox, so only its owner can get in.
  if (status === 'unclaimed') {
    await reclaimAccount(event, newUserId)
  }
  const needsPasswordSetup = status !== 'existing'

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

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'invite',
    resource: 'user',
    resourceId: newUserId,
    after: { role: body.role, email: body.email },
  })
  await batchWithAudit(db, [roleInsert], auditInsert)
  clearCachedRole(newUserId, siteId)

  if (needsPasswordSetup) {
    // A brand-new (or just-reclaimed) invitee has no password they can actually use (see the
    // signUpEmail comment above) — sending them a "visit /login" email would be
    // a dead end. Instead, trigger the exact same requestPasswordReset flow the
    // "Forgot password?" page (app/pages/forgot-password.vue) uses for an
    // existing user: it generates a real, single-use token and emails it via the
    // already-working `sendResetPassword` callback in server/utils/better-auth.ts.
    // That's the ONE email a newly-invited user receives, and its link lets them
    // set a password and log in — no separate "you've been invited" email is
    // sent here, since a second email pointing at a login page they can't yet
    // use would only add a dead end, not clarity.
    try {
      const auth = await getOrCreateBetterAuth(event)
      await auth.api.requestPasswordReset({
        body: { email: body.email, redirectTo: '/reset-password' },
      })
    }
    catch (err) {
      console.error('[invite] Failed to send set-password email:', err)
    }
  }
  else {
    // Existing user already has working credentials for their account — being
    // added to this site just needs a pointer to sign in, same as before.
    const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true, domain: true } })
    const siteName = site?.name ?? 'NuxFlow'
    waitUntil(event, sendTemplatedEmail(event, {
      to: body.email,
      subject: `You've been added to ${siteName}`,
      category: 'invite',
      template: {
        heading: `You've been added to ${siteName}`,
        paragraphs: [`Hi ${body.name},`, `You now have ${body.role} access to ${siteName}. Sign in with your existing account to get started.`],
        action: { label: 'Sign in', url: `https://${site?.domain ?? 'nuxflow.app'}/login` },
      },
    }).catch(err => console.error('[invite] Email delivery failed:', err)))
  }

  return created(event, { id: newUserId, name: body.name, email: body.email, role: body.role })
})
