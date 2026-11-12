/**
 * Reads booked dates out of an iCal file — the "export calendar" links Airbnb, Booking.com,
 * Vrbo and others give a holiday let. Import-free, so the server sync and tests share it.
 *
 * Only the dates matter: each VEVENT becomes a stay from its first night (DTSTART) to the day
 * the guests leave (DTEND, not a night). Booking sites send all-day dates
 * (`DTSTART;VALUE=DATE:20261201`); a timed event is read as the date it starts and ends on
 * in UTC (or its own floating date), which is close enough for a nights calendar. Cancelled
 * events are skipped, an event with no end is one night, and a range that ends before it
 * starts is dropped.
 */

export interface BookedRange {
  /** First night, YYYY-MM-DD. */
  start: string
  /** The day they leave (exclusive), YYYY-MM-DD. */
  end: string
  /** The event's SUMMARY ("Reserved", "Airbnb (Not available)"), trimmed. */
  summary: string
}

/** Most ranges read from one file — a booking site's export is a few hundred at most. */
export const MAX_IMPORTED_RANGES = 2000

const DATE_RE = /^(\d{4})(\d{2})(\d{2})/

function unfold(text: string): string[] {
  // RFC 5545 §3.1: a line starting with a space or tab continues the previous one.
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

/** "DTSTART;VALUE=DATE:20261201" → "2026-12-01"; null when it isn't a date. */
function readDate(value: string): string | null {
  const m = DATE_RE.exec(value.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const date = `${y}-${mo}-${d}`
  return isValidIsoDate(date) ? date : null
}

export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const t = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date
}

/** "2026-12-01" + 1 → "2026-12-02". */
export function addIsoDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

export function parseIcalRanges(text: string, max = MAX_IMPORTED_RANGES): BookedRange[] {
  const out: BookedRange[] = []
  let inEvent = false
  let start: string | null = null
  let end: string | null = null
  let summary = ''
  let cancelled = false

  for (const raw of unfold(text)) {
    const line = raw.trimEnd()
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      inEvent = true
      start = end = null
      summary = ''
      cancelled = false
      continue
    }
    if (upper === 'END:VEVENT') {
      if (inEvent && start && !cancelled) {
        const e = end ?? addIsoDays(start, 1)
        if (e > start) out.push({ start, end: e, summary: summary.slice(0, 200) })
        else if (e === start) out.push({ start, end: addIsoDays(start, 1), summary: summary.slice(0, 200) })
        if (out.length >= max) break
      }
      inEvent = false
      continue
    }
    if (!inEvent) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const name = line.slice(0, colon).split(';')[0]!.toUpperCase()
    const value = line.slice(colon + 1)
    if (name === 'DTSTART') start = readDate(value)
    else if (name === 'DTEND') end = readDate(value)
    else if (name === 'SUMMARY') summary = unescapeText(value)
    else if (name === 'STATUS' && value.trim().toUpperCase() === 'CANCELLED') cancelled = true
  }
  return out
}

/** Joins overlapping or touching ranges, sorted — what the public calendar needs. */
export function mergeRanges(ranges: Array<{ start: string; end: string }>): Array<{ start: string; end: string }> {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const merged: Array<{ start: string; end: string }> = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end
    }
    else {
      merged.push({ start: r.start, end: r.end })
    }
  }
  return merged
}
