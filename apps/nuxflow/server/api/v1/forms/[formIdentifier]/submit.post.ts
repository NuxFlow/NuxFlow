import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { verifyTurnstile } from '../../../../utils/turnstile'
import { rateLimit } from '../../../../utils/rate-limit'
import { sendEmail, escapeHtml } from '../../../../utils/email'
import { resolveSetting } from '../../../../utils/settings'
import { formSubmissions, userSiteRoles } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { ulid } from 'ulid'
import { getFormBySlugOrThrow } from '../../../../utils/resource-queries'
import { created } from '../../../../utils/response'

interface FormNotificationsConfig {
  enabled?: boolean
  email?: string
}

const bodySchema = z.object({
  turnstileToken: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
})

// This is a public, unauthenticated endpoint — validate submitted values against the form's
// own declared fields rather than trusting an arbitrary z.record(). Blocks extra/unexpected
// keys, missing required fields, and oversized/deeply-nested payloads.
const MAX_FIELD_VALUE_LENGTH = 10_000

function validateSubmissionData(data: Record<string, unknown>, fields: FormField[]): string | null {
  const known = new Map(fields.map(f => [f.name, f]))

  for (const key of Object.keys(data)) {
    if (!known.has(key)) return `Unknown field: ${key}`
  }

  for (const field of fields) {
    const value = data[field.name]
    if (field.required && (value === undefined || value === null || value === '')) {
      return `Missing required field: ${field.name}`
    }
    if (value === undefined || value === null) continue

    if (field.type === 'checkbox' && Array.isArray(value)) {
      if (value.some(v => typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) {
        return `Invalid value for field: ${field.name}`
      }
      continue
    }

    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return `Invalid value for field: ${field.name}`
    }
    if (typeof value === 'string' && value.length > MAX_FIELD_VALUE_LENGTH) {
      return `Value too long for field: ${field.name}`
    }
  }

  return null
}

export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'form-submit' })

  const db = useDb(event)
  const siteId = event.context.siteId as string
  const formIdentifier = getRouterParam(event, 'formIdentifier')!
  const body = await parseBody(event, bodySchema)

  const form = await getFormBySlugOrThrow(db, siteId, formIdentifier)
  if (form.status !== 'active') throw forbidden('This form is not accepting submissions')

  const validationErr = validateSubmissionData(body.data, form.fields)
  if (validationErr) throw validationError(validationErr)

  const ip = getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? undefined
  const valid = await verifyTurnstile(body.turnstileToken ?? '', ip)
  if (!valid) throw validationError('Spam check failed')

  const id = ulid()
  await db.insert(formSubmissions).values({
    id,
    formId: form.id,
    siteId,
    data: body.data,
    ipAddress: ip ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
    status: 'new',
  })

  // Best-effort admin notification email — mirrors the contact form's own
  // notification logic (server/api/v1/contact/submit.post.ts). The form's
  // `notifications` column is a minimal { enabled, email? } config set from
  // the form builder's settings panel; when no explicit email is configured,
  // fall back to the site's notificationEmail setting, then the first admin.
  const notifyConfig = form.notifications as FormNotificationsConfig | null
  if (notifyConfig?.enabled) {
    try {
      let notifyEmail = notifyConfig.email || (await resolveSetting(event, 'notificationEmail')) as string | undefined

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

      const dataEntries = Object.entries(body.data)
        .map(([key, value]) => `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</p>`)
        .join('')

      await sendEmail(event, {
        to: notifyEmail,
        subject: `New submission: ${form.name}`,
        html: `<p>A new submission was received for <strong>${escapeHtml(form.name)}</strong>.</p>${dataEntries}`,
        text: `New submission for ${form.name}:\n\n${Object.entries(body.data).map(([k, v]) => `${k}: ${v}`).join('\n')}`,
      })
    } catch (err: unknown) {
      console.error('Failed to send form submission notification email:', err)
      // Intentionally swallowed — the submission itself already succeeded.
    }
  }

  return created(event, { success: true, redirectUrl: form.redirectUrl })
})
