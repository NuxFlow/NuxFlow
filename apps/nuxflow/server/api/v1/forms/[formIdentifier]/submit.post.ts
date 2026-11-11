import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { verifyTurnstile } from '../../../../utils/turnstile'
import { rateLimit } from '../../../../utils/rate-limit'
import { sendTemplatedEmail } from '../../../../utils/email-template'
import { siteNotificationEmail } from '../../../../utils/notify'
import { formSubmissions } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { getFormBySlugOrThrow } from '../../../../utils/resource-queries'
import { created } from '../../../../utils/response'
import { getCfBindings, waitUntil } from '../../../../utils/cf-env'
import { moderateText } from '../../../../utils/moderation'
import { dispatchPluginHook } from '../../../../utils/plugin-hooks'
import { requireSiteId } from '../../../../utils/site-context'
import { getClientIp } from '../../../../utils/client-ip'
import { isDemoMode, DEMO_DISABLED_MESSAGE } from '../../../../utils/demo-mode'
import { checkPlanLimit } from '../../../../utils/hosting-plans'
import { noticePlanLimitOnce } from '../../../../utils/plan-limit-notice'
import {
  FORM_SUBMIT_MAX_BODY_BYTES,
  collectFormFiles,
  discardStoredFormFiles,
  formValueText,
  publicSubmissionData,
  storeFormFiles,
  totalBytes,
  type IncomingFormFile,
  type MultipartPart,
} from '../../../../utils/form-files'
import { formatFileSize, storedFormFiles } from '../../../../../shared/lib/form-files'
import { hiddenFieldNames, parseShowIf } from '../../../../../shared/lib/form-logic'

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
const MAX_CHECKBOX_VALUES = 100

function validateSubmissionData(data: Record<string, unknown>, fields: FormField[], files: Map<string, IncomingFormFile[]>, hidden: Set<string>): string | null {
  const known = new Map(fields.map(f => [f.name, f]))

  for (const key of Object.keys(data)) {
    if (!known.has(key)) return `Unknown field: ${key}`
  }

  for (const field of fields) {
    // A step heading has no answer, and a question hidden by its condition is never
    // required — its answer, if any, is dropped (shared/lib/form-logic.ts).
    if (field.type === 'step' || hidden.has(field.name)) continue
    const value = data[field.name]
    // File fields arrive as multipart parts, never in `data`. A page cached before files
    // worked sends the bare file name (or '' when empty): '' is dropped, a name refused.
    if (field.type === 'file') {
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value !== 'string') return `Invalid value for field: ${field.name}`
        return `Please reload the page and attach the file for "${field.label || field.name}" again.`
      }
      if (field.required && !files.get(field.name)?.length) return `Missing required field: ${field.name}`
      continue
    }
    if (field.required && (value === undefined || value === null || value === '')) {
      return `Missing required field: ${field.name}`
    }
    if (value === undefined || value === null) continue

    if (field.type === 'checkbox' && Array.isArray(value)) {
      if (value.length > MAX_CHECKBOX_VALUES) return `Too many values for field: ${field.name}`
      if (value.some(v => typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')) {
        return `Invalid value for field: ${field.name}`
      }
      if (value.some(v => typeof v === 'string' && v.length > MAX_FIELD_VALUE_LENGTH)) {
        return `Value too long for field: ${field.name}`
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
  const siteId = requireSiteId(event)
  const formIdentifier = getRouterParam(event, 'formIdentifier')!

  // A form with file fields posts multipart/form-data: a `payload` part holding the usual
  // JSON body, plus one `file:<field name>` part per file. Without files it stays JSON.
  const isMultipart = (getHeader(event, 'content-type') ?? '').toLowerCase().startsWith('multipart/form-data')
  let body: z.infer<typeof bodySchema>
  let parts: MultipartPart[] = []
  if (isMultipart) {
    const length = Number(getHeader(event, 'content-length') ?? 0)
    if (length > FORM_SUBMIT_MAX_BODY_BYTES) throw httpError({ status: 413, message: 'Those files are too big. Send up to 25 MB in one go.' })
    parts = await readMultipartFormData(event) ?? []
    const payload = parts.find(p => p.name === 'payload' && !p.filename)
    let json: unknown = null
    try {
      json = JSON.parse(payload ? new TextDecoder().decode(payload.data) : '')
    }
    catch {
      // Falls through to the schema check below.
    }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) throw validationError('Invalid submission')
    body = parsed.data
  }
  else {
    body = await parseBody(event, bodySchema)
  }

  const form = await getFormBySlugOrThrow(db, siteId, formIdentifier)
  if (form.status !== 'active') throw forbidden('This form is not accepting submissions')

  const { files, error: fileError } = collectFormFiles(parts, form.fields)
  if (fileError) throw validationError(fileError)

  // "Show this field only when…": worked out from the answers as sent (files count as
  // answers), exactly as the visitor's browser did. Hidden questions keep nothing.
  const answers: Record<string, unknown> = { ...body.data, ...Object.fromEntries(files) }
  const hidden = hiddenFieldNames(form.fields.map(f => ({ ...f, showIf: parseShowIf(f.showIf) })), answers)
  for (const name of hidden) files.delete(name)

  const validationErr = validateSubmissionData(body.data, form.fields, files, hidden)
  if (validationErr) throw validationError(validationErr)

  // File fields' empty leftovers from older pages, step headings and hidden questions are
  // dropped; the files go in below.
  const dropped = new Set([...hidden, ...form.fields.filter(f => f.type === 'file' || f.type === 'step').map(f => f.name)])
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(body.data).filter(([key]) => !dropped.has(key)))

  const ip = getClientIp(event) ?? undefined
  const valid = await verifyTurnstile(body.turnstileToken ?? '', ip)
  if (!valid) throw validationError('Spam check failed')

  const id = ulid()
  const bytes = totalBytes(files)
  let storedBytes = 0
  if (bytes > 0) {
    if (isDemoMode(event)) throw forbidden(DEMO_DISABLED_MESSAGE)
    if (!getCfBindings(event).r2) {
      throw httpError({ status: 503, message: "This form can't take files yet. Please send your message without them, or get in touch another way.", data: { code: 'storage_required' } })
    }
    // A visitor can't do anything about the site's plan, so they get a plain message and
    // the site's admins are told (once a month), as with inbound mail over the limit.
    const check = await checkPlanLimit(db, siteId, 'storage', bytes)
    if (!check.allowed) {
      await noticePlanLimitOnce(event, siteId, 'storage', "A form couldn't take files", `Someone tried to send files with "${form.name}", but the site's storage is full. Delete some media, or ask about a bigger plan.`)
      throw httpError({ status: 507, message: "This form can't take files right now. Please send your message without them.", data: { code: 'storage_full' } })
    }
    const stored = await storeFormFiles(event, { siteId, formId: form.id, submissionId: id }, files)
    Object.assign(data, stored.data)
    storedBytes = stored.storedBytes
  }

  try {
    await db.insert(formSubmissions).values({
      id,
      formId: form.id,
      siteId,
      data,
      storedBytes,
      ipAddress: ip ?? null,
      userAgent: getHeader(event, 'user-agent') ?? null,
      status: 'new',
    })
  }
  catch (err) {
    await discardStoredFormFiles(event, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, storedFormFiles(v)])))
    throw err
  }

  // Best-effort AI spam check, same reasoning as comments.post.ts — a supplementary
  // content-based filter on top of the Turnstile check already performed above, since
  // Turnstile only proves "a real browser submitted this," not "this content isn't spam."
  waitUntil(event, (async () => {
    const text = Object.values(data).map(formValueText).join('\n')
    const result = await moderateText(event, text)
    if (result?.flagged) {
      await db.update(formSubmissions).set({ status: 'spam' }).where(and(eq(formSubmissions.id, id), eq(formSubmissions.siteId, siteId)))
      return
    }
    // After the spam check, so plugins (`hook:form.submitted`) never act on spam.
    await dispatchPluginHook(event, siteId, 'form.submitted', {
      submissionId: id, formId: form.id, formSlug: form.slug, formName: form.name, data: publicSubmissionData(data),
    })
  })().catch(err => console.error('[forms] Post-submission processing failed:', err)))

  // Best-effort admin notification email — mirrors the contact form's own
  // notification logic (server/api/v1/contact/submit.post.ts). The form's
  // `notifications` column is a minimal { enabled, email? } config set from
  // the form builder's settings panel; when no explicit email is configured,
  // fall back to the site's notificationEmail setting, then the first admin.
  const notifyConfig = form.notifications as FormNotificationsConfig | null
  if (notifyConfig?.enabled) {
    try {
      const notifyEmail = notifyConfig.email || await siteNotificationEmail(event, siteId)

      if (!notifyEmail) {
        throw new Error('No notification email address is configured, and no admin users were found to use as a fallback.')
      }

      // Reply-To the submitter when the form collected an email-typed field, so the
      // notification can be answered directly.
      const emailField = form.fields.find(f => f.type === 'email')
      const submitterEmail = emailField ? data[emailField.name] : undefined

      await sendTemplatedEmail(event, {
        to: notifyEmail,
        subject: `New submission: ${form.name}`,
        category: 'form_notification',
        ...(typeof submitterEmail === 'string' && submitterEmail.includes('@') ? { replyTo: submitterEmail } : {}),
        template: {
          heading: `New submission: ${form.name}`,
          paragraphs: Object.entries(data).map(([key, value]) => {
            const attached = storedFormFiles(value)
            return attached.length
              ? `${key}: ${attached.map(f => `${f.name} (${formatFileSize(f.size)})`).join(', ')}`
              : `${key}: ${formValueText(value)}`
          }),
          ...(storedBytes > 0 ? { footnote: 'Files are kept on your site. Open this submission in Admin → Forms to download them.' } : {}),
        },
      })
    } catch (err: unknown) {
      console.error('Failed to send form submission notification email:', err)
      // Intentionally swallowed — the submission itself already succeeded.
    }
  }

  return created(event, { success: true, redirectUrl: form.redirectUrl })
})
