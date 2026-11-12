/**
 * One-to-one appointments: the rules, import-free (server, admin and tests share them).
 *
 * - **Settings** (`appointments.settings`, Settings → Appointments): when the practitioner
 *   takes appointments — the site's opening hours (Settings → Business, holiday hours
 *   included) or hours of their own — and days off.
 * - **Service** (an Appointment block's props): name, length, price, the gap kept after each
 *   appointment, how much notice is needed, how far ahead people can book, the refund rule.
 * - **Free times** (`freeTimes()`): the starts on one date, in the site's time zone, that fit
 *   inside the hours, respect the notice, and don't overlap anything already booked.
 *
 * Wall-clock ↔ UTC conversion is passed in (`toUtc`), so this file stays free of imports and
 * the caller uses `zonedToUtc` from @nuxflow/canvas/events.
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = typeof WEEKDAYS[number]

export interface TimeRange {
  /** HH:MM */
  open: string
  /** HH:MM; earlier than `open` (or equal) means up to midnight */
  close: string
}

export interface DayOff {
  /** YYYY-MM-DD, first day off */
  from: string
  /** YYYY-MM-DD, last day off (inclusive) */
  to: string
  note?: string
}

export interface AppointmentSettings {
  /** Take appointments during the opening hours in Settings → Business. */
  useOpeningHours: boolean
  /** Otherwise, these hours. */
  hours: Record<Weekday, TimeRange[]>
  daysOff: DayOff[]
}

export interface AppointmentService {
  name: string
  /** Minutes. */
  duration: number
  /** Minutes between possible start times. */
  step: number
  /** Minutes kept free after each appointment. */
  buffer: number
  /** Hours of notice needed before an appointment. */
  noticeHours: number
  /** How many days ahead can be booked. */
  daysAhead: number
  /** Null = free. */
  price: number | null
  currency: string
  /** Hours before the start a visitor can still cancel for a refund (0 = any time before). */
  cancelHours: number
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function emptyWeek(): Record<Weekday, TimeRange[]> {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
}

export function defaultAppointmentSettings(): AppointmentSettings {
  return { useOpeningHours: true, hours: emptyWeek(), daysOff: [] }
}

function ranges(value: unknown): TimeRange[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((r): r is TimeRange => Boolean(r) && typeof r === 'object' && TIME.test(String((r as TimeRange).open)) && TIME.test(String((r as TimeRange).close)))
    .slice(0, 4)
    .map(r => ({ open: r.open, close: r.close }))
}

/** Reads the stored setting leniently: anything unreadable is left out. */
export function parseAppointmentSettings(value: unknown): AppointmentSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const rawHours = (v.hours && typeof v.hours === 'object' ? v.hours : {}) as Record<string, unknown>
  const hours = emptyWeek()
  for (const d of WEEKDAYS) hours[d] = ranges(rawHours[d])
  const daysOff = (Array.isArray(v.daysOff) ? v.daysOff : [])
    .filter((d): d is DayOff => Boolean(d) && typeof d === 'object' && DATE.test(String((d as DayOff).from)) && DATE.test(String((d as DayOff).to)))
    .slice(0, 200)
    .map(d => ({ from: d.from, to: d.to < d.from ? d.from : d.to, ...(typeof d.note === 'string' && d.note.trim() ? { note: d.note.trim().slice(0, 100) } : {}) }))
  return { useOpeningHours: v.useOpeningHours !== false, hours, daysOff }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

/** An Appointment block's props as a service. Never throws. */
export function parseService(props: Record<string, unknown> | null | undefined, fallbackName = 'Appointment'): AppointmentService {
  const p = props ?? {}
  const duration = clampInt(p.duration, 5, 480, 60)
  const priceNum = p.price === '' || p.price == null ? null : Number(p.price)
  const currency = typeof p.currency === 'string' && /^[a-z]{3}$/i.test(p.currency.trim()) ? p.currency.trim().toUpperCase() : 'GBP'
  return {
    name: (typeof p.serviceName === 'string' && p.serviceName.trim() ? p.serviceName.trim() : fallbackName).slice(0, 120),
    duration,
    step: clampInt(p.step, 5, 240, Math.min(duration, 30)),
    buffer: clampInt(p.buffer, 0, 240, 0),
    noticeHours: clampInt(p.noticeHours, 0, 24 * 60, 12),
    daysAhead: clampInt(p.daysAhead, 1, 365, 60),
    price: priceNum !== null && Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum * 100) / 100 : null,
    currency,
    cancelHours: clampInt(p.cancelHours, 0, 24 * 30, 24),
  }
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return h * 60 + m
}

function hhmm(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]!
}

export function isDayOff(settings: AppointmentSettings, date: string): boolean {
  return settings.daysOff.some(d => d.from <= date && date <= d.to)
}

export interface Busy {
  /** ISO instant */
  start: string
  /** ISO instant: the booking's end plus its gap */
  end: string
}

export interface FreeTime {
  /** ISO instant */
  start: string
  /** ISO instant */
  end: string
  /** HH:MM on the site's clock */
  time: string
}

/**
 * The start times free on `date` (site wall clock) within `hours` (that date's working hours,
 * already worked out — days off, own hours or opening hours). A time is offered when the whole
 * appointment fits inside one range, it's at least `noticeHours` from `now`, and the
 * appointment plus its gap overlaps nothing in `busy`.
 */
export function freeTimes(opts: {
  date: string
  hours: TimeRange[]
  service: AppointmentService
  busy: Busy[]
  now: Date
  toUtc: (wallClock: string) => string | null
}): FreeTime[] {
  const { date, hours, service, busy, now, toUtc } = opts
  const earliest = now.getTime() + service.noticeHours * 3_600_000
  const out: FreeTime[] = []
  const seen = new Set<string>()
  for (const range of hours) {
    const open = minutes(range.open)
    let close = minutes(range.close)
    if (close <= open) close = 24 * 60
    for (let t = open; t + service.duration <= close; t += service.step) {
      const time = hhmm(t)
      if (seen.has(time)) continue
      const startIso = toUtc(`${date}T${time}`)
      if (!startIso) continue
      const start = Date.parse(startIso)
      if (start < earliest) continue
      const end = start + service.duration * 60_000
      const blocked = end + service.buffer * 60_000
      const clash = busy.some(b => Date.parse(b.start) < blocked && Date.parse(b.end) > start)
      if (clash) continue
      seen.add(time)
      out.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), time })
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1))
}

/** "1 hour", "45 minutes", "1 hour 30 minutes". */
export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const parts = []
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`)
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`)
  return parts.join(' ') || '0 minutes'
}
