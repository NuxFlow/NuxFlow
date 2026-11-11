import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { formSubmissions } from '@nuxflow/db/schema'
import type { FormField } from '@nuxflow/db/schema'
import { useDb } from './db'
import { getCfBindings } from './cf-env'
import {
  FORM_FILES_MAX_TOTAL_BYTES,
  FORM_FILES_PER_FIELD,
  formFileContentType,
  formFilePartName,
  formFileProblem,
  storedFormFiles,
  type StoredFormFile,
} from '../../shared/lib/form-files'

/**
 * Files sent with a Form Builder submission (a trades quote's photo, a CV, a signed PDF).
 * They live in the media bucket under `_private/<siteId>/forms/<formId>/<submissionId>/`,
 * outside the public media route's `<siteId>/` prefix, and are only ever served to the
 * site's team (editor+, the same people who can read submissions). Site deletion and site
 * moves already cover `_private/<siteId>/`; deleting a form deletes its prefix here.
 */

export interface IncomingFormFile {
  name: string
  type: string
  data: Uint8Array
}

/** Multipart parts as h3's readMultipartFormData() returns them. */
export interface MultipartPart {
  name?: string
  filename?: string
  type?: string
  data: Uint8Array
}

/** Room for the JSON part and multipart framing on top of the files themselves. */
export const FORM_SUBMIT_MAX_BODY_BYTES = FORM_FILES_MAX_TOTAL_BYTES + 1024 * 1024

/**
 * Picks the file parts out of a multipart submission and checks them against the form:
 * only `file` fields, at most FORM_FILES_PER_FIELD each, allowed types and sizes, and the
 * total. Returns the files by field name, or a message for the visitor.
 */
export function collectFormFiles(parts: MultipartPart[], fields: FormField[]): { files: Map<string, IncomingFormFile[]>; error: string | null } {
  const fileFields = new Map(fields.filter(f => f.type === 'file').map(f => [formFilePartName(f.name), f]))
  const files = new Map<string, IncomingFormFile[]>()
  let total = 0

  for (const part of parts) {
    if (!part.name?.startsWith('file:')) continue
    const field = fileFields.get(part.name)
    if (!field) return { files, error: `Unknown file field: ${part.name.slice(5)}` }
    // A file input left empty still sends a part with an empty filename in some browsers.
    if (!part.filename && !part.data.byteLength) continue

    const name = (part.filename || 'file').replace(/[\\/]/g, '_').slice(-200)
    const problem = formFileProblem({ name, size: part.data.byteLength })
    if (problem) return { files, error: problem }

    const list = files.get(field.name) ?? []
    if (list.length >= FORM_FILES_PER_FIELD) return { files, error: `You can send up to ${FORM_FILES_PER_FIELD} files for "${field.label || field.name}".` }
    total += part.data.byteLength
    if (total > FORM_FILES_MAX_TOTAL_BYTES) return { files, error: `Those files are too big together. Send up to ${FORM_FILES_MAX_TOTAL_BYTES / 1024 / 1024} MB in one go.` }
    list.push({ name, type: formFileContentType(name)!, data: part.data })
    files.set(field.name, list)
  }
  return { files, error: null }
}

export function totalBytes(files: Map<string, IncomingFormFile[]>): number {
  let n = 0
  for (const list of files.values()) for (const f of list) n += f.data.byteLength
  return n
}

function submissionPrefix(siteId: string, formId: string, submissionId: string): string {
  return `_private/${siteId}/forms/${formId}/${submissionId}/`
}

function safeName(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-100) || 'file'
}

function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * Writes a submission's files to R2. Returns each field's stored files (what goes in the
 * submission's `data`) and the bytes kept. If any write fails, the ones already written are
 * removed and the error is rethrown, so nothing is left behind for a submission that wasn't
 * saved.
 */
export async function storeFormFiles(
  event: H3Event,
  ids: { siteId: string; formId: string; submissionId: string },
  files: Map<string, IncomingFormFile[]>,
): Promise<{ data: Record<string, StoredFormFile[]>; storedBytes: number }> {
  const { r2 } = getCfBindings(event)
  if (!r2) throw new Error('No MEDIA_BUCKET binding')
  const prefix = submissionPrefix(ids.siteId, ids.formId, ids.submissionId)
  const data: Record<string, StoredFormFile[]> = {}
  const written: string[] = []
  let storedBytes = 0
  try {
    for (const [field, list] of files) {
      data[field] = []
      for (const file of list) {
        const key = `${prefix}${ulid()}-${safeName(file.name)}`
        await r2.put(key, file.data, {
          httpMetadata: { contentType: file.type, contentDisposition: attachmentDisposition(file.name) },
        })
        written.push(key)
        storedBytes += file.data.byteLength
        data[field].push({ kind: 'file', name: file.name, size: file.data.byteLength, type: file.type, key })
      }
    }
  }
  catch (err) {
    if (written.length) await r2.delete(written).catch(() => null)
    throw err
  }
  return { data, storedBytes }
}

/** Removes keys a failed submission had already written. Best effort. */
export async function discardStoredFormFiles(event: H3Event, data: Record<string, StoredFormFile[]>): Promise<void> {
  const { r2 } = getCfBindings(event)
  const keys = Object.values(data).flat().map(f => f.key)
  if (r2 && keys.length) await r2.delete(keys).catch(() => null)
}

/**
 * Deletes every uploaded file of the given forms (call before or after deleting the forms
 * themselves — the files are found by prefix, not through the rows). Best effort: anything
 * left is only clutter, and goes when the site is deleted.
 */
export async function deleteFormFiles(event: H3Event, siteId: string, formIds: string[]): Promise<void> {
  const { r2 } = getCfBindings(event)
  if (!r2) return
  for (const formId of formIds) {
    const prefix = `_private/${siteId}/forms/${formId}/`
    try {
      let cursor: string | undefined
      do {
        const page = await r2.list({ prefix, cursor, limit: 1000 })
        if (page.objects.length) await r2.delete(page.objects.map(o => o.key))
        cursor = page.truncated ? page.cursor : undefined
      } while (cursor)
    }
    catch (err) {
      console.error(`[forms] Deleting the uploaded files of form ${formId} failed:`, err)
    }
  }
}

/**
 * Serves one uploaded file to the site's team. The caller has already checked the role; this
 * checks the submission belongs to the site and the key sits under that submission's own
 * prefix, so a value in `data` can never name another site's or another form's object.
 */
export async function serveFormFile(event: H3Event, siteId: string, submissionId: string, field: string, index: number): Promise<Response> {
  const db = useDb(event)
  const sub = await db.query.formSubmissions.findFirst({
    where: and(eq(formSubmissions.id, submissionId), eq(formSubmissions.siteId, siteId)),
    columns: { id: true, formId: true, data: true },
  })
  if (!sub) notFound('File not found')
  const file = storedFormFiles(sub.data[field])[index]
  if (!file || !file.key.startsWith(submissionPrefix(siteId, sub.formId, sub.id))) notFound('File not found')

  const { r2 } = getCfBindings(event)
  const object = r2 ? await r2.get(file.key) : null
  if (!object) notFound('This file is no longer stored.')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Length', String(object.size))
  headers.set('Cache-Control', 'private, no-store')
  headers.set('Content-Security-Policy', 'sandbox; default-src \'none\'')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Robots-Tag', 'noindex')
  if (!headers.has('Content-Disposition')) headers.set('Content-Disposition', attachmentDisposition(file.name))
  return new Response(object.body, { status: 200, headers })
}

/** A submission value as plain text, for emails, moderation and plugin payloads. */
export function formValueText(value: unknown): string {
  const files = storedFormFiles(value)
  if (files.length) return files.map(f => f.name).join(', ')
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** The submission data handed to plugins: file values without their storage keys. */
export function publicSubmissionData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    const files = storedFormFiles(v)
    out[k] = files.length ? files.map(({ name, size, type }) => ({ name, size, type })) : v
  }
  return out
}
