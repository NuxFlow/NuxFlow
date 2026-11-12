// Click and collect: the days and times a customer can collect a shop order, worked out from
// the shop's notice and the business's opening hours (Settings → Business, holiday hours
// included), in the site's time zone. Shared by the basket page (which shows the choices)
// and checkout (which checks the one chosen, again, at the moment of paying).

import { hasAnyHours, siteClock, slotsOn, type BusinessInfo } from '@nuxflow/canvas/business'

/** Collection times are offered every quarter of an hour. */
export const COLLECTION_STEP_MINUTES = 15

export interface CollectionDay {
  /** YYYY-MM-DD, site time. */
  date: string
  /** "Tue 18 Nov". */
  label: string
  /** "HH:MM" times to choose from; empty means any time that day (no opening hours set). */
  times: string[]
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

function hhmm(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function dayLabel(date: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  }
  catch {
    return date
  }
}

/**
 * The collection choices from now: no earlier than `leadMinutes` from now, over today and the
 * next `days` days, within opening hours when the business has them. A slot running past
 * midnight is offered up to midnight.
 */
export function collectionDays(opts: {
  info: BusinessInfo | null
  timeZone: string
  leadMinutes: number
  days: number
  now: Date
  locale?: string
}): CollectionDay[] {
  const locale = opts.locale || 'en'
  const today = siteClock(opts.now, opts.timeZone).date
  const earliest = siteClock(new Date(opts.now.getTime() + opts.leadMinutes * 60_000), opts.timeZone)
  const withHours = hasAnyHours(opts.info)
  const out: CollectionDay[] = []
  for (let n = 0; n <= Math.max(0, opts.days); n++) {
    const date = addDays(today, n)
    if (date < earliest.date) continue
    if (!withHours) {
      out.push({ date, label: dayLabel(date, locale), times: [] })
      continue
    }
    const times = new Set<number>()
    for (const slot of slotsOn(opts.info!, date).slots) {
      const open = minutes(slot.open)
      const close = slot.close === '24:00' || minutes(slot.close) <= open ? 24 * 60 : minutes(slot.close)
      for (let t = Math.ceil(open / COLLECTION_STEP_MINUTES) * COLLECTION_STEP_MINUTES; t < close; t += COLLECTION_STEP_MINUTES) {
        if (date === earliest.date && t < earliest.minute) continue
        times.add(t)
      }
    }
    if (times.size) out.push({ date, label: dayLabel(date, locale), times: [...times].sort((a, b) => a - b).map(hhmm) })
  }
  return out
}

/** "2026-11-18T14:30" or "2026-11-18" (any time) — when it's one of the choices offered. */
export function isCollectionChoice(days: CollectionDay[], value: string): boolean {
  const [date, time] = value.split('T')
  const day = days.find(d => d.date === date)
  if (!day) return false
  return day.times.length ? Boolean(time && day.times.includes(time)) : !time
}

/** "Tue 18 Nov, 14:30" / "Tue 18 Nov" for a chosen collection time. */
export function formatCollectAt(value: string, locale = 'en'): string {
  const [date, time] = value.split('T')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return value
  return time ? `${dayLabel(date, locale)}, ${time}` : dayLabel(date, locale)
}
