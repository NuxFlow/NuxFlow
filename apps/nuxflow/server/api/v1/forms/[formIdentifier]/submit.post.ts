import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { verifyTurnstile } from '../../../../utils/turnstile'
import { rateLimit } from '../../../../utils/rate-limit'
import { formSubmissions } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { getFormBySlugOrThrow } from '../../../../utils/resource-queries'
import { created } from '../../../../utils/response'

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

  return created(event, { success: true, redirectUrl: form.redirectUrl })
})
