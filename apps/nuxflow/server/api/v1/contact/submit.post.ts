import { z } from 'zod'
import { forms, formSubmissions, siteSettings } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../utils/db'
import { verifyTurnstile } from '../../../utils/turnstile'
import { rateLimit } from '../../../utils/rate-limit'
import { sendEmail, escapeHtml } from '../../../utils/email'

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
    const notifyEmail = emailSetting?.value as string | undefined
    if (notifyEmail) {
      await sendEmail(event, {
        to: notifyEmail,
        subject: `New contact: ${body.subject || body.name}`,
        html: `<p><strong>From:</strong> ${escapeHtml(body.name)} &lt;${escapeHtml(body.email)}&gt;</p>
<p><strong>Subject:</strong> ${escapeHtml(body.subject ?? '(none)')}</p>
<p><strong>Message:</strong></p>
<pre style="white-space:pre-wrap">${escapeHtml(body.message)}</pre>`,
        text: `From: ${body.name} <${body.email}>\nSubject: ${body.subject ?? '(none)'}\n\n${body.message}`,
      })
    }
  } catch {
    // Submission saved; don't fail the response if email isn't configured
  }

  setResponseStatus(event, 201)
  return { success: true }
})
