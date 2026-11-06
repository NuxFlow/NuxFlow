// Dates and calendar files for events, shared by the server (feeds, emails, validation),
// the admin and the Calendar block. Import-free so all three can use it.
//
// How an event's times are stored:
// - A timed event is a UTC instant (ISO 8601). It is entered and shown in the site's own
//   time zone, so "18:00" means 18:00 at the venue wherever the visitor is.
// - An all-day event is a calendar date, stored as that date at midnight UTC
//   (`2027-07-15T00:00:00.000Z`), and is never converted between zones. Its end is the
//   last day, inclusive. Older all-day rows hold the author's local midnight as an instant
//   (`2027-07-14T23:00:00.000Z`), which `eventDay()` reads as the date that was meant.

export interface EventTimes {
  eventStartAt: string
  eventEndAt?: string | null
  eventAllDay?: boolean | null
}

const FLOATING_DATE = /^\d{4}-\d{2}-\d{2}(?:T00:00(?::00(?:\.0+)?)?Z)?$/

/**
 * Reads a stored date. Takes ISO 8601 as well as SQLite's `datetime('now')` form
 * (`2026-11-04 12:30:00`, which is UTC). Null when it isn't a date.
 */
export function parseStoredDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(' ', 'T')}Z` : value
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const formatters = new Map<string, Intl.DateTimeFormat>()

// Constructing these is slow, and a calendar month formats hundreds of dates.
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    }
    catch {
      // A stored zone this runtime doesn't know: show UTC rather than crash the page.
      return zoneFormatter('UTC')
    }
    formatters.set(timeZone, formatter)
  }
  return formatter
}

function zoneParts(date: Date, timeZone: string): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const part of zoneFormatter(timeZone).formatToParts(date)) parts[part.type] = part.value
  return parts
}

/** A stored instant as the site's wall clock: `YYYY-MM-DDTHH:mm`. Empty for a bad date. */
export function utcToZoned(value: string | null | undefined, timeZone: string): string {
  const date = parseStoredDate(value)
  if (!date) return ''
  const p = zoneParts(date, timeZone)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

function offsetAt(utcMs: number, timeZone: string): number {
  const p = zoneParts(new Date(utcMs), timeZone)
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** The site's wall clock (`YYYY-MM-DDTHH:mm`) as a UTC instant. Null for a bad value. */
export function zonedToUtc(local: string | null | undefined, timeZone: string): string | null {
  const m = local?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  if (Number.isNaN(wall)) return null
  // The offset depends on the instant being found, so it's taken twice: the second pass
  // settles a time close to a clock change.
  const first = wall - offsetAt(wall, timeZone)
  return new Date(wall - offsetAt(first, timeZone)).toISOString()
}

/** Today's date in a time zone: `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const p = zoneParts(now, timeZone)
  return `${p.year}-${p.month}-${p.day}`
}

/** A date moved by whole days. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Whole days from one date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000)
}

/** How an all-day event's date is stored. */
export function floatingDate(day: string): string {
  return `${day}T00:00:00.000Z`
}

/** The calendar date a stored value falls on, in the site's time zone. Empty for a bad date. */
export function eventDay(value: string | null | undefined, allDay: boolean | null | undefined, timeZone: string): string {
  if (!value) return ''
  if (allDay && FLOATING_DATE.test(value)) return value.slice(0, 10)
  return utcToZoned(value, timeZone).slice(0, 10)
}

/** The first and last date of an event. An end at midnight belongs to the day before it. */
export function eventDayRange(event: EventTimes, timeZone: string): { first: string; last: string } | null {
  const first = eventDay(event.eventStartAt, event.eventAllDay, timeZone)
  if (!first) return null
  let last = eventDay(event.eventEndAt, event.eventAllDay, timeZone) || first
  if (!event.eventAllDay && event.eventEndAt && utcToZoned(event.eventEndAt, timeZone).endsWith('T00:00')) {
    last = addDays(last, -1)
  }
  return { first, last: last < first ? first : last }
}

/** Every date an event covers, capped so a mistyped year can't fill a calendar. */
export function eventDays(event: EventTimes, timeZone: string, maxDays = 62): string[] {
  const range = eventDayRange(event, timeZone)
  if (!range) return []
  const days = [range.first]
  while (days.length < maxDays && days[days.length - 1]! < range.last) days.push(addDays(days[days.length - 1]!, 1))
  return days
}

/** True once an event is completely over. */
export function eventHasEnded(event: EventTimes, timeZone: string, now: Date = new Date()): boolean {
  if (event.eventAllDay) {
    const range = eventDayRange(event, timeZone)
    return range ? range.last < todayIn(timeZone, now) : false
  }
  const end = parseStoredDate(event.eventEndAt) ?? parseStoredDate(event.eventStartAt)
  return end ? end.getTime() < now.getTime() : false
}

/** True once an event's first moment has passed. */
export function eventHasStarted(event: EventTimes, timeZone: string, now: Date = new Date()): boolean {
  if (event.eventAllDay) {
    const range = eventDayRange(event, timeZone)
    return range ? range.first < todayIn(timeZone, now) : false
  }
  const start = parseStoredDate(event.eventStartAt)
  return start ? start.getTime() <= now.getTime() : false
}

/** When an event happens, in words, in the site's time zone. Empty for a bad date. */
export function formatEventWhen(event: EventTimes, timeZone: string, locale?: string): string {
  const dayFormat: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
  const formatDay = (day: string) => new Date(`${day}T00:00:00.000Z`).toLocaleDateString(locale, dayFormat)
  const range = eventDayRange(event, timeZone)
  if (!range) return ''

  if (event.eventAllDay) {
    return range.first === range.last ? formatDay(range.first) : `${formatDay(range.first)} – ${formatDay(range.last)}`
  }

  const start = parseStoredDate(event.eventStartAt)!
  const end = parseStoredDate(event.eventEndAt)
  const zone = safeZone(timeZone)
  const time = (date: Date, withZone: boolean) => date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
    ...(withZone ? { timeZoneName: 'short' as const } : {}),
  })
  if (!end) return `${formatDay(range.first)}, ${time(start, true)}`
  if (range.first === range.last) return `${formatDay(range.first)}, ${time(start, false)} – ${time(end, true)}`
  return `${formatDay(range.first)}, ${time(start, false)} – ${formatDay(eventDay(event.eventEndAt, false, timeZone))}, ${time(end, true)}`
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  }
  catch {
    return 'UTC'
  }
}

// ── Repeating events ────────────────────────────────────────────────────────
// A repeating event is one content item plus a rule. Its stored start and end are the first
// date's; every other date is worked out here, by the site's wall clock, so a class at 18:00
// stays at 18:00 when the clocks change. A date is identified by its day (`YYYY-MM-DD` in
// the site's zone): a rule produces at most one per day.

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly'

export interface EventRecurrence {
  freq: RecurrenceFreq
  /** Every this many days, weeks or months. */
  interval: number
  /** Weekly only: 0 = Sunday. Defaults to the weekday of the first date. */
  weekdays?: number[]
  /** The last date it can happen on, inclusive. */
  until?: string | null
  /** Dates taken out of the series, such as a holiday or a cancelled class. */
  skip?: string[]
}

export interface EventOccurrence {
  /** Identifies this date within the series. */
  date: string
  startAt: string
  endAt: string | null
}

/** How far ahead a list of dates looks when the rule gives nothing sooner. */
const OCCURRENCE_HORIZON_DAYS = 732

const dayOfWeek = (day: string) => new Date(`${day}T00:00:00.000Z`).getUTCDay()

function ruleIncludes(rule: EventRecurrence, first: string, day: string): boolean {
  if (day < first) return false
  if (rule.until && day > rule.until) return false
  if (rule.skip?.includes(day)) return false
  const interval = Math.max(1, Math.trunc(rule.interval) || 1)
  if (rule.freq === 'daily') return daysBetween(first, day) % interval === 0
  if (rule.freq === 'weekly') {
    const weekdays = rule.weekdays?.length ? rule.weekdays : [dayOfWeek(first)]
    if (!weekdays.includes(dayOfWeek(day))) return false
    // Weeks count from the Monday on or before the first date, so "every 2 weeks on Tue and
    // Thu" keeps both days in the same fortnight.
    const monday = addDays(first, -((dayOfWeek(first) + 6) % 7))
    return Math.floor(daysBetween(monday, day) / 7) % interval === 0
  }
  // A date this month doesn't have (the 31st) is simply missed, as a calendar app does.
  if (day.slice(8) !== first.slice(8)) return false
  const months = (Number(day.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(day.slice(5, 7)) - Number(first.slice(5, 7))
  return months % interval === 0
}

/** One date of a series, or null when the rule doesn't include that day. */
export function occurrenceOn(event: EventTimes, rule: EventRecurrence, day: string, timeZone: string): EventOccurrence | null {
  const first = eventDay(event.eventStartAt, event.eventAllDay, timeZone)
  if (!first || !ruleIncludes(rule, first, day)) return null
  const shift = daysBetween(first, day)
  if (event.eventAllDay) {
    const lastDay = eventDay(event.eventEndAt, true, timeZone)
    return { date: day, startAt: floatingDate(day), endAt: lastDay ? floatingDate(addDays(lastDay, shift)) : null }
  }
  const moved = (stored: string | null | undefined): string | null => {
    const local = utcToZoned(stored, timeZone)
    return local ? zonedToUtc(`${addDays(local.slice(0, 10), shift)}${local.slice(10)}`, timeZone) : null
  }
  const startAt = moved(event.eventStartAt)
  return startAt ? { date: day, startAt, endAt: moved(event.eventEndAt) } : null
}

/** The series' dates from one day to another, inclusive, soonest first. */
export function occurrencesBetween(event: EventTimes, rule: EventRecurrence, timeZone: string, from: string, to: string, max = 500): EventOccurrence[] {
  const first = eventDay(event.eventStartAt, event.eventAllDay, timeZone)
  if (!first) return []
  const out: EventOccurrence[] = []
  const end = rule.until && rule.until < to ? rule.until : to
  for (let day = from > first ? from : first; day <= end && out.length < max; day = addDays(day, 1)) {
    const occurrence = occurrenceOn(event, rule, day, timeZone)
    if (occurrence) out.push(occurrence)
  }
  return out
}

/** The next dates of a series that haven't finished yet. */
export function upcomingOccurrences(event: EventTimes, rule: EventRecurrence, timeZone: string, count: number, now: Date = new Date()): EventOccurrence[] {
  const today = todayIn(timeZone, now)
  // A day back, for a date that began yesterday and runs past midnight.
  const dates = occurrencesBetween(event, rule, timeZone, addDays(today, -1), addDays(today, OCCURRENCE_HORIZON_DAYS), count + 2)
  return dates
    .filter(d => !eventHasEnded({ eventStartAt: d.startAt, eventEndAt: d.endAt, eventAllDay: event.eventAllDay }, timeZone, now))
    .slice(0, count)
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** A rule in words: "Every week on Tue, Thu". */
export function describeRecurrence(rule: EventRecurrence, locale?: string): string {
  const interval = Math.max(1, Math.trunc(rule.interval) || 1)
  const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[rule.freq]
  let text = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`
  if (rule.freq === 'weekly' && rule.weekdays?.length) {
    // 2023-01-01 was a Sunday.
    const names = WEEKDAY_ORDER.filter(d => rule.weekdays!.includes(d))
      .map(d => new Date(Date.UTC(2023, 0, 1 + d)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }))
    text += ` on ${names.join(', ')}`
  }
  if (rule.until) {
    const until = new Date(`${rule.until}T00:00:00.000Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    text += ` until ${until}`
  }
  return text
}

// ── Calendar files (RFC 5545) ───────────────────────────────────────────────

export interface IcsEvent extends EventTimes {
  id: string
  title: string
  excerpt?: string | null
  eventLocation?: string | null
  url?: string | null
  /** When the event last changed; calendar apps use it to spot updates. */
  updatedAt?: string | null
}

export interface IcsCalendar {
  /** Makes each event's UID globally unique. */
  domain: string
  timeZone: string
  name?: string
  events: IcsEvent[]
}

/** TEXT escaping (§3.3.11). Backslash first, or the ones added below get escaped again. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?|\n/g, '\\n')
}

/** Lines over 75 bytes continue on the next line after a space (§3.1), never mid-character. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    if (bytes + size > 75) {
      out.push(current)
      current = ' '
      bytes = 1
    }
    current += char
    bytes += size
  }
  out.push(current)
  return out.join('\r\n')
}

function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

function icsUrl(url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\/[^\s"<>\\]+$/i.test(url)) return null
  return url
}

function eventLines(event: IcsEvent, calendar: IcsCalendar): string[] {
  const start = parseStoredDate(event.eventStartAt)
  const range = eventDayRange(event, calendar.timeZone)
  // One unreadable date must not take the whole feed down with it.
  if (!start || !range) return []

  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.id}@${calendar.domain}`,
    `DTSTAMP:${icsStamp(parseStoredDate(event.updatedAt) ?? new Date())}`,
  ]
  if (event.eventAllDay) {
    // An all-day DTEND is the day after the last one.
    lines.push(`DTSTART;VALUE=DATE:${range.first.replace(/-/g, '')}`)
    lines.push(`DTEND;VALUE=DATE:${addDays(range.last, 1).replace(/-/g, '')}`)
  }
  else {
    const stored = parseStoredDate(event.eventEndAt)
    const end = stored && stored >= start ? stored : new Date(start.getTime() + 3_600_000)
    lines.push(`DTSTART:${icsStamp(start)}`)
    lines.push(`DTEND:${icsStamp(end)}`)
  }
  lines.push(`SUMMARY:${escapeIcsText(event.title)}`)
  if (event.excerpt) lines.push(`DESCRIPTION:${escapeIcsText(event.excerpt)}`)
  if (event.eventLocation) lines.push(`LOCATION:${escapeIcsText(event.eventLocation)}`)
  const url = icsUrl(event.url)
  if (url) lines.push(`URL:${url}`)
  lines.push('END:VEVENT')
  return lines
}

/** A complete calendar file, for a subscription feed or a single event. */
export function buildIcsCalendar(calendar: IcsCalendar): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NuxFlow//NuxFlow Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  if (calendar.name) lines.push(`X-WR-CALNAME:${escapeIcsText(calendar.name)}`)
  lines.push(`X-WR-TIMEZONE:${calendar.timeZone}`)
  lines.push('REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H')
  for (const event of calendar.events) lines.push(...eventLines(event, calendar))
  lines.push('END:VCALENDAR', '')
  return lines.map(foldIcsLine).join('\r\n')
}
