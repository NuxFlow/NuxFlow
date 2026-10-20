// Helpers for Admin → Forms → Submissions (the inbox every form shares, including the
// built-in contact form).

export type SubmissionStatus = 'new' | 'read' | 'spam' | 'archived'

export interface InboxField { id?: string; name?: string; label?: string; type?: string }
export interface InboxSubmission {
  id: string
  createdAt: string
  status: SubmissionStatus
  data: Record<string, unknown>
}
export interface SubmissionColumn { key: string; label: string }

/** A field's data key: submissions are keyed by `name`; forms imported from older
 * bundles may only carry `id` (the built-in contact form's ids equal its keys). */
function fieldKey(f: InboxField): string | undefined {
  return f.name || f.id || undefined
}

/**
 * Columns to show/export: the form's own fields in form order (labelled), then any extra
 * keys found in the submissions themselves — data saved before a field was renamed or
 * removed, or the contact form's fixed fields when its stored definition differs.
 */
export function submissionColumns(fields: InboxField[] | null | undefined, submissions: InboxSubmission[]): SubmissionColumn[] {
  const cols: SubmissionColumn[] = []
  const seen = new Set<string>()
  for (const f of fields ?? []) {
    const key = fieldKey(f)
    if (!key || seen.has(key) || f.type === 'hidden') continue
    seen.add(key)
    cols.push({ key, label: f.label || key })
  }
  for (const s of submissions) {
    for (const key of Object.keys(s.data ?? {})) {
      if (seen.has(key)) continue
      seen.add(key)
      cols.push({ key, label: key })
    }
  }
  return cols
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(displayValue).join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

// Plain addresses only: no ? & , ; : so a visitor-typed value can't add mailto
// parameters (?bcc=…) or extra recipients to the Reply link.
const EMAIL_RE = /^[^\s@<>"?&,;:]+@[^\s@<>"?&,;:.]+(?:\.[^\s@<>"?&,;:.]+)+$/

/** The submitter's email for a Reply link: an `email`-type field first, then a key named
 * like an email. Only returned when it looks like a plain address (it's visitor input). */
export function replyAddress(fields: InboxField[] | null | undefined, sub: InboxSubmission): string | null {
  const keys = [
    ...(fields ?? []).filter(f => f.type === 'email').map(fieldKey),
    'email', 'Email', 'e-mail',
  ].filter((k): k is string => Boolean(k))
  for (const key of keys) {
    const v = sub.data?.[key]
    if (typeof v === 'string' && EMAIL_RE.test(v.trim())) return v.trim()
  }
  return null
}

/** One-line preview for the list: the first two non-empty values, then a snippet of the rest. */
export function submissionPreview(columns: SubmissionColumn[], sub: InboxSubmission): { title: string; detail: string } {
  const values = columns.map(c => displayValue(sub.data?.[c.key]).trim()).filter(Boolean)
  return { title: values[0] ?? '(empty submission)', detail: values.slice(1, 3).join(' · ') }
}

// Neutralizes CSV/formula injection (OWASP): a submitted value starting with =, +, -, @,
// tab, or CR can be interpreted as a formula by Excel/Sheets when the export is opened —
// prefixing with a literal quote forces it to be read as text instead.
export function sanitizeCsvCell(value: unknown): string {
  const raw = displayValue(value)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return JSON.stringify(safe)
}

export function submissionsToCsv(columns: SubmissionColumn[], submissions: InboxSubmission[]): string {
  const header = ['Submitted at', 'Status', ...columns.map(c => c.label)].map(sanitizeCsvCell).join(',')
  const rows = submissions.map(s =>
    [s.createdAt, s.status, ...columns.map(c => s.data?.[c.key])].map(sanitizeCsvCell).join(','),
  )
  return [header, ...rows].join('\n')
}
