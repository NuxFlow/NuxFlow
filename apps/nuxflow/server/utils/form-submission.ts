import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { formSubmissions } from '@nuxflow/db/schema'
import type { FormField, forms } from '@nuxflow/db/schema'
import { useDb } from './db'
import { waitUntil } from './cf-env'
import { moderateText } from './moderation'
import { dispatchPluginHook } from './plugin-hooks'
import { sendTemplatedEmail } from './email-template'
import { siteNotificationEmail } from './notify'
import { formValueText, publicSubmissionData, type IncomingFormFile } from './form-files'
import { formatFileSize, storedFormFiles } from '../../shared/lib/form-files'
import { hiddenFieldNames, parseShowIf } from '../../shared/lib/form-logic'
import type { PublicFormField } from '../../shared/lib/form-types'

/**
 * Checking and saving a Form Builder submission — shared by the form's own submit route and
 * by bookings that ask for an intake form (a health waiver before a class), so both apply
 * the same rules and both notify the team and plugins the same way.
 */

type FormRow = typeof forms.$inferSelect

const MAX_FIELD_VALUE_LENGTH = 10_000
const MAX_CHECKBOX_VALUES = 100

// This is public input — values are checked against the form's own declared fields rather
// than trusting an arbitrary record. Blocks extra keys, missing required answers and
// oversized or nested values.
function firstProblem(data: Record<string, unknown>, fields: FormField[], files: Map<string, IncomingFormFile[]>, hidden: Set<string>): string | null {
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
      return `Missing required field: ${field.label || field.name}`
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

/**
 * Checks a submission's answers against its form and returns what to keep: hidden
 * questions, step headings and file fields' leftovers dropped, and `files` trimmed to the
 * shown questions. Throws a 422 with the first problem.
 */
export function checkFormAnswers(fields: FormField[], answers: Record<string, unknown>, files: Map<string, IncomingFormFile[]> = new Map()): Record<string, unknown> {
  // "Show this field only when…": worked out from the answers as sent (files count as
  // answers), exactly as the visitor's browser did.
  const hidden = hiddenFieldNames(fields.map(f => ({ ...f, showIf: parseShowIf(f.showIf) })), { ...answers, ...Object.fromEntries(files) })
  for (const name of hidden) files.delete(name)

  const problem = firstProblem(answers, fields, files, hidden)
  if (problem) validationError(problem)

  const dropped = new Set([...hidden, ...fields.filter(f => f.type === 'file' || f.type === 'step').map(f => f.name)])
  return Object.fromEntries(Object.entries(answers).filter(([key]) => !dropped.has(key)))
}

interface FormNotificationsConfig {
  enabled?: boolean
  email?: string
}

/**
 * Saves a checked submission (the caller has already stored any files under `id`), then in
 * the background runs the AI spam check and the `form.submitted` plugin hook, and emails the
 * form's notification address if it has one. `onInsertError` lets the caller clean up files.
 */
export async function saveFormSubmission(event: H3Event, form: FormRow, input: {
  id: string
  data: Record<string, unknown>
  storedBytes?: number
  ip?: string | null
  onInsertError?: () => Promise<void>
}): Promise<void> {
  const db = useDb(event)
  const { id, data } = input
  const siteId = form.siteId
  const storedBytes = input.storedBytes ?? 0

  try {
    await db.insert(formSubmissions).values({
      id,
      formId: form.id,
      siteId,
      data,
      storedBytes,
      ipAddress: input.ip ?? null,
      userAgent: getHeader(event, 'user-agent') ?? null,
      status: 'new',
    })
  }
  catch (err) {
    await input.onInsertError?.()
    throw err
  }

  // Best-effort AI spam check, same reasoning as comments.post.ts — a supplementary
  // content-based filter on top of Turnstile, which only proves "a real browser sent this".
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

  // Best-effort admin notification, like the contact form's: the form's own address, else the
  // site's notification address, else the first admin.
  const notifyConfig = form.notifications as FormNotificationsConfig | null
  if (!notifyConfig?.enabled) return
  try {
    const notifyEmail = notifyConfig.email || await siteNotificationEmail(event, siteId)
    if (!notifyEmail) {
      throw new Error('No notification email address is configured, and no admin users were found to use as a fallback.')
    }
    // Reply-To the submitter when the form collected an email-typed field.
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
  }
  catch (err: unknown) {
    // The submission itself already succeeded.
    console.error('Failed to send form submission notification email:', err)
  }
}

/**
 * What a visitor's browser gets of a field: enough to render it, never the form's
 * notification settings or anything else internal.
 */
export function publicFormField(f: FormField): PublicFormField {
  return {
    id: f.id,
    type: f.type,
    label: f.label,
    name: f.name,
    placeholder: f.placeholder,
    required: f.required,
    options: f.options,
    // Only 'computed' fields need their formula on the client to render a value.
    formula: f.type === 'computed' ? f.formula : undefined,
    // Multi-step forms and conditional questions (shared/lib/form-logic.ts).
    showIf: parseShowIf(f.showIf) ?? undefined,
  }
}
