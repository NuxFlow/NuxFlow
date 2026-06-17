import { z } from 'zod'
import { forms, formSubmissions, siteSettings, userSiteRoles } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../utils/db'
import { verifyTurnstile } from '../../../utils/turnstile'
import { rateLimit } from '../../../utils/rate-limit'
import { sendEmail, escapeHtml } from '../../../utils/email'
import { resolveSetting } from '../../../utils/settings'
import { sendPushToUser } from '../../../utils/webpush'

const CONTACT_SLUG = 'contact'

const CONTACT_FIELDS: FormField[] = [
  { id: 'name',    type: 'text',     label: 'Name',    name: 'name',    required: true },
  { id: 'email',   type: 'email',    label: 'Email',   name: 'email',   required: true },
  { id: 'subject', type: 'text',     label: 'Subject', name: 'subject', required: false },
  { id: 'message', type: 'textarea', label: 'Message', name: 'message', required: true },
]

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  subject: z.string().max(300).optional(),
  message: z.string().min(1).max(5000),
  turnstileToken: z.string().optional(),
})

async function getOrCreateContactForm(db: ReturnType<typeof useDb>, siteId: string): Promise<string> {
  const existing = await db.query.forms.findFirst({
    where: and(eq(forms.siteId, siteId), eq(forms.slug, CONTACT_SLUG)),
    columns: { id: true },
  })
  if (existing) return existing.id

  const id = ulid()
  await db.insert(forms).values({
    id,
    siteId,
    name: 'Contact Form',
    slug: CONTACT_SLUG,
    fields: CONTACT_FIELDS,
    logic: [],
    status: 'active',
  })
  return id
}

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'contact-submit' })

  const siteId = event.context.siteId as string
  const submitterUserId = (event.context.user as { id?: string } | undefined)?.id ?? null
  const body = await readValidatedBody(event, bodySchema.parse)

  const ip = getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? undefined
  const valid = await verifyTurnstile(body.turnstileToken ?? '', ip)
  if (!valid) throw createError({ statusCode: 422, message: 'Spam check failed' })

  const db = useDb(event)
  const formId = await getOrCreateContactForm(db, siteId)

  await db.insert(formSubmissions).values({
    id: ulid(),
    formId,
    siteId,
    data: {
      name: body.name,
      email: body.email,
      subject: body.subject ?? '',
      message: body.message,
    },
    ipAddress: ip ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
    status: 'new',
  })

  // Best-effort email notification
  try {
    const emailSetting = await db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, 'notificationEmail')),
      columns: { value: true },
    })
    let notifyEmail = emailSetting?.value as string | undefined

    // Fallback: use first admin's email if no notificationEmail is set
    if (!notifyEmail) {
      const firstAdmin = await db.query.userSiteRoles.findFirst({
        where: and(eq(userSiteRoles.siteId, siteId), inArray(userSiteRoles.role, ['admin', 'super_admin'])),
        with: {
          user: {
            columns: { email: true }
          }
        }
      })
      notifyEmail = firstAdmin?.user?.email
    }

    if (!notifyEmail) {
      throw new Error('No notification email address is configured, and no admin users were found to use as a fallback.')
    }

    await sendEmail(event, {
      to: notifyEmail,
      replyTo: body.email,
      subject: `New contact: ${body.subject || body.name}`,
      html: `<p><strong>From:</strong> ${escapeHtml(body.name)} &lt;${escapeHtml(body.email)}&gt;</p>
<p><strong>Subject:</strong> ${escapeHtml(body.subject ?? '(none)')}</p>
<p><strong>Message:</strong></p>
<pre style="white-space:pre-wrap">${escapeHtml(body.message)}</pre>`,
      text: `From: ${body.name} <${body.email}>\nSubject: ${body.subject ?? '(none)'}\n\n${body.message}`,
    })
  } catch (err: unknown) {
    console.error('Failed to send contact notification email:', err)
    // We intentionally don't throw an error here because the submission
    // was successfully saved to the database. We just log the failure.
  }

  // Push confirmation to the logged-in member who submitted
  if (submitterUserId) {
    const pushEnabled = await resolveSetting(event, 'push.events.form_submission')
    if (pushEnabled === 'true') {
      sendPushToUser(event, submitterUserId, {
        title: 'Message received',
        body: 'Thanks for your message. We\'ll be in touch soon.',
      }).catch(err => console.error('[push] Form submission push failed:', err))
    }
  }

  setResponseStatus(event, 201)
  return { success: true }
})
