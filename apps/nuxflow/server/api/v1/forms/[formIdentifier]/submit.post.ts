import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { verifyTurnstile } from '../../../../utils/turnstile'
import { rateLimit } from '../../../../utils/rate-limit'
import { ulid } from 'ulid'
import { getFormBySlugOrThrow } from '../../../../utils/resource-queries'
import { created } from '../../../../utils/response'
import { getCfBindings } from '../../../../utils/cf-env'
import { requireSiteId } from '../../../../utils/site-context'
import { getClientIp } from '../../../../utils/client-ip'
import { isDemoMode, DEMO_DISABLED_MESSAGE } from '../../../../utils/demo-mode'
import { checkPlanLimit } from '../../../../utils/hosting-plans'
import { noticePlanLimitOnce } from '../../../../utils/plan-limit-notice'
import {
  FORM_SUBMIT_MAX_BODY_BYTES,
  collectFormFiles,
  discardStoredFormFiles,
  storeFormFiles,
  totalBytes,
  type MultipartPart,
} from '../../../../utils/form-files'
import { checkFormAnswers, saveFormSubmission } from '../../../../utils/form-submission'
import { storedFormFiles } from '../../../../../shared/lib/form-files'

const bodySchema = z.object({
  turnstileToken: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
})

// A visitor's answers to a Form Builder form. Checking and saving are shared with booking
// intake forms (server/utils/form-submission.ts); files are this route's own.
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

  // Hidden questions, step headings and file-field leftovers are dropped; `files` keeps only
  // the shown questions' files, which go in below.
  const data = checkFormAnswers(form.fields, body.data, files)

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

  await saveFormSubmission(event, form, {
    id,
    data,
    storedBytes,
    ip,
    onInsertError: () => discardStoredFormFiles(event, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, storedFormFiles(v)]))),
  })

  return created(event, { success: true, redirectUrl: form.redirectUrl })
})
