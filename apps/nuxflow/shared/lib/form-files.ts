// File-upload fields on Form Builder forms — the limits and the stored shape, shared by the
// public form, the submit route and the admin inbox. Import-free.

/** Files one file field accepts. */
export const FORM_FILES_PER_FIELD = 5
/** Largest single file. */
export const FORM_FILE_MAX_BYTES = 10 * 1024 * 1024
/** Largest total for one submission (all its file fields together). */
export const FORM_FILES_MAX_TOTAL_BYTES = 25 * 1024 * 1024

/**
 * What a visitor may send: photos (iPhones send HEIC), PDFs and office documents. No SVG,
 * HTML or scripts — files are only ever served as downloads with a sandbox CSP, but there's
 * no reason to keep anything a browser would run.
 */
const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
}

/** For the file input's `accept` attribute. */
export const FORM_FILE_ACCEPT = Object.keys(EXTENSION_TYPES).map(e => `.${e}`).join(',')

export const FORM_FILE_RULES_TEXT = `Up to ${FORM_FILES_PER_FIELD} files, ${FORM_FILE_MAX_BYTES / 1024 / 1024} MB each: photos, PDFs or documents.`

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * The content type a file is stored with, decided by its extension (the browser's own type
 * is visitor-supplied), or null when the file isn't one we take.
 */
export function formFileContentType(name: string): string | null {
  return EXTENSION_TYPES[extensionOf(name)] ?? null
}

/** Why a file can't be sent, or null when it's fine. Messages are for the visitor. */
export function formFileProblem(file: { name: string; size: number }): string | null {
  if (!formFileContentType(file.name)) return `"${file.name}" isn't a file type this form takes. Send photos, PDFs or documents.`
  if (file.size <= 0) return `"${file.name}" is empty.`
  if (file.size > FORM_FILE_MAX_BYTES) return `"${file.name}" is too big. Each file can be up to ${FORM_FILE_MAX_BYTES / 1024 / 1024} MB.`
  return null
}

/** One uploaded file as it's kept in `form_submissions.data[field]` (always an array). */
export interface StoredFormFile {
  kind: 'file'
  name: string
  size: number
  type: string
  /** R2 key, always under `_private/<siteId>/forms/<formId>/<submissionId>/`. */
  key: string
}

export function isStoredFormFile(value: unknown): value is StoredFormFile {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.kind === 'file' && typeof v.name === 'string' && typeof v.size === 'number' && typeof v.key === 'string'
}

/** A submission value's files, or [] when it isn't a file value. */
export function storedFormFiles(value: unknown): StoredFormFile[] {
  return Array.isArray(value) ? value.filter(isStoredFormFile) : []
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** The multipart part name a file field's files travel under. */
export function formFilePartName(fieldName: string): string {
  return `file:${fieldName}`
}
