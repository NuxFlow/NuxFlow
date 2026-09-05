import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { userSiteRoles, sites } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'
import { requireRole, getUserSiteRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { sendEmail, escapeHtml } from '../../../utils/email'
import { rateLimit } from '../../../utils/rate-limit'
import { created } from '../../../utils/response'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'author', 'viewer', 'member']).default('viewer'),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'user-invite' })
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!

  const body = await parseBody(event, bodySchema)

  const db = useDb(event)
  const auth = await getOrCreateBetterAuth(event)

  // Check if a user with this email already exists (e.g. previously removed from this site)
  let existingUser = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, body.email),
    columns: { id: true },
  })

  let isNewAccount = false

  if (existingUser) {
    // Check they aren't already a member of this site
    const alreadyMember = await getUserSiteRole(db, existingUser.id, siteId)
    if (alreadyMember) {
      throw conflict('This user is already a member of this site')
    }
  } else {
    // Better Auth requires a password at sign-up time, but the invited user never
    // sees or uses this one — it's immediately made moot by the real, working
    // set-password link emailed below (see the requestPasswordReset call), which
    // lets the recipient set their own password before ever signing in.
    const tempPassword = ulid()
    await auth.api.signUpEmail({
      body: { name: body.name, email: body.email, password: tempPassword },
    })
    existingUser = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, body.email),
      columns: { id: true },
    })
    if (!existingUser) throw createError({ statusCode: 500, message: 'Failed to create user' })
    isNewAccount = true
  }

  const newUser = existingUser

  const roleInsert = db.insert(userSiteRoles).values({
    id: ulid(),
    userId: newUser.id,
    siteId,
    role: body.role,
  })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'invite',
    resource: 'user',
    resourceId: newUser.id,
    after: { role: body.role, email: body.email },
  })
  await batchWithAudit(db, [roleInsert], auditInsert)

  if (isNewAccount) {
    // A brand-new invitee has no password they can actually use (see the
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
    const siteName = escapeHtml(site?.name ?? 'NuxFlow')
    const loginUrl = `https://${escapeHtml(site?.domain ?? 'nuxflow.app')}/login`
    void sendEmail(event, {
      to: body.email,
      subject: `You've been invited to ${site?.name ?? 'NuxFlow'}`,
      html: `<p>Hi ${escapeHtml(body.name)},</p><p>You have been invited to join <strong>${siteName}</strong> as <strong>${escapeHtml(body.role)}</strong>.</p><p>Visit <a href="${loginUrl}">${loginUrl}</a> to sign in.</p>`,
      text: `Hi ${body.name}, you have been invited to join ${site?.name ?? 'NuxFlow'} as ${body.role}. Visit https://${site?.domain ?? 'nuxflow.app'}/login to sign in.`,
    }).catch(err => console.error('[invite] Email delivery failed:', err))
  }

  return created(event, { id: newUser.id, name: body.name, email: body.email, role: body.role })
})
