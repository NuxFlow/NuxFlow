import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { userSiteRoles, sites } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { sendEmail, escapeHtml } from '../../../utils/email'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'author', 'viewer', 'member']).default('viewer'),
})

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'user-invite' })
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId!

  const body = await readValidatedBody(event, bodySchema.parse)

  const db = useDb(event)

  const auth = serverAuth(event)
  const tempPassword = crypto.randomUUID()
  await auth.api.signUpEmail({
    body: { name: body.name, email: body.email, password: tempPassword },
  })

  const newUser = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, body.email),
    columns: { id: true },
  })

  if (!newUser) throw createError({ statusCode: 500, message: 'Failed to create user' })

  await db.insert(userSiteRoles).values({
    id: ulid(),
    userId: newUser.id,
    siteId,
    role: body.role,
  })

  void writeAuditLog(event, userId, {
    action: 'invite',
    resource: 'user',
    resourceId: newUser.id,
    after: { role: body.role, email: body.email },
  })

  // Send invitation email
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true, domain: true } })
  const siteName = escapeHtml(site?.name ?? 'NuxFlow')
  const loginUrl = `https://${escapeHtml(site?.domain ?? 'nuxflow.app')}/login`
  void sendEmail({
    to: body.email,
    subject: `You've been invited to ${site?.name ?? 'NuxFlow'}`,
    html: `<p>Hi ${escapeHtml(body.name)},</p><p>You have been invited to join <strong>${siteName}</strong> as <strong>${escapeHtml(body.role)}</strong>.</p><p>Visit <a href="${loginUrl}">${loginUrl}</a> to sign in.</p>`,
    text: `Hi ${body.name}, you have been invited to join ${site?.name ?? 'NuxFlow'} as ${body.role}. Visit https://${site?.domain ?? 'nuxflow.app'}/login to sign in.`,
  }).catch(err => console.error('[invite] Email delivery failed:', err))

  setResponseStatus(event, 201)
  return { id: newUser.id, name: body.name, email: body.email, role: body.role }
})
