/**
 * Shared currency formatter for membership tier prices — used by every surface that
 * renders a tier's price (Paywall, MembershipsBlock, the account page's active-plan
 * summary) so a future formatting change (e.g. locale-awareness beyond hardcoded 'en')
 * only needs to be made once instead of drifting across independent copies.
 */
export function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 0 }).format(price)
}

/**
 * Shared byte-count formatter — used by every admin surface that displays a file/media
 * size (media library, video library, the super-admin database stats page) so the same
 * unit thresholds and decimal precision aren't reimplemented independently.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit++
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`
}

/**
 * Shared video-duration formatter (m:ss) — used by both the video library grid card
 * and its detail modal so the two stay in sync.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * D1 `datetime('now')` columns are UTC strings with a space and no zone
 * ("2026-09-25 14:03:00"). Parsed as-is, most browsers read them as local time and
 * Safari rejects the space outright — normalise to ISO-8601 UTC first.
 */
export function parseDbDate(value: string): Date {
  return new Date(/z|[+-]\d\d:?\d\d$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`)
}

type DateInput = string | Date | null | undefined

function toValidDate(value: DateInput): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : parseDbDate(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * "October 22, 2026" — a fixed locale and UTC, so the server and the visitor's browser
 * render the same text (any difference is a hydration mismatch). For public and account pages.
 */
export function formatDate(value: DateInput, fallback = '—'): string {
  const d = toValidDate(value)
  return d ? d.toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : fallback
}

/** A date in the viewer's own locale and timezone — for admin screens. */
export function formatLocalDate(value: DateInput, fallback = '—'): string {
  const d = toValidDate(value)
  return d ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : fallback
}

/** A date and time in the viewer's own locale and timezone — for admin screens. */
export function formatLocalDateTime(value: DateInput, fallback = '—'): string {
  const d = toValidDate(value)
  return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : fallback
}
