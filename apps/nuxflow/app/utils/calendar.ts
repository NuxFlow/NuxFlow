import { addDays, daysBetween, floatingDate, utcToZoned, zonedToUtc } from '@nuxflow/canvas/events'

// The logic behind Admin → Calendar, apart from the page so it can be tested.

export interface CalendarItem {
  id: string
  title: string
  slug: string
  status: string
  typeId: string
  type: { id: string; slug: string; name: string; icon: string | null } | null
  version: number
  canEdit: boolean
  publishedAt: string | null
  scheduledAt: string | null
  eventStartAt: string | null
  eventEndAt: string | null
  eventAllDay: boolean | null
  eventLocation: string | null
  /** First and last day it shows on, in the site's time zone. Absent while it has no date. */
  calendarDate?: string
  calendarEndDate?: string
  /** One date of a repeating event, which is changed in the event's editor, not dragged. */
  repeats?: boolean
}

export interface CalendarCell {
  /** Null for the padding before the 1st and after the last day. */
  date: string | null
  day: number | null
}

/** A month's cells, whole weeks only. `weekStart`: 0 = Sunday, 1 = Monday. */
export function monthCells(year: number, month: number, weekStart: 0 | 1): CalendarCell[] {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const pad = String(month + 1).padStart(2, '0')
  const cells: CalendarCell[] = []
  for (let i = 0; i < (firstDow - weekStart + 7) % 7; i++) cells.push({ date: null, day: null })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: `${year}-${pad}-${String(d).padStart(2, '0')}`, day: d })
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null })
  return cells
}

/** The time a date gets when it's first placed on a day. */
const DEFAULT_TIME = 'T09:00'

function moveKeepingTime(stored: string, shift: number, timeZone: string): string | null {
  const local = utcToZoned(stored, timeZone)
  if (!local) return null
  return zonedToUtc(`${addDays(local.slice(0, 10), shift)}${local.slice(10)}`, timeZone)
}

/** Whether dragging can move it: when something was published is a fact, not a plan. */
export function canMoveItem(item: CalendarItem): boolean {
  if (!item.canEdit || item.repeats) return false
  if (item.type?.slug === 'event' || item.eventStartAt) return true
  return item.status === 'draft' || item.status === 'review' || item.status === 'scheduled'
}

/**
 * What to save when an item is dropped on a day. An event keeps its length and time of day
 * (by the site's clock, even across a clock change). Anything else keeps its time of day,
 * or gets a default one. Null when it can't move, or is already there.
 */
export function datesForDrop(item: CalendarItem, day: string, timeZone: string): Record<string, string | null> | null {
  if (!canMoveItem(item)) return null

  if (item.eventStartAt && item.calendarDate) {
    const shift = daysBetween(item.calendarDate, day)
    if (shift === 0) return null
    if (item.eventAllDay) {
      return {
        eventStartAt: floatingDate(day),
        eventEndAt: item.calendarEndDate && item.eventEndAt ? floatingDate(addDays(item.calendarEndDate, shift)) : null,
      }
    }
    return {
      eventStartAt: moveKeepingTime(item.eventStartAt, shift, timeZone),
      eventEndAt: item.eventEndAt ? moveKeepingTime(item.eventEndAt, shift, timeZone) : null,
    }
  }
  if (item.type?.slug === 'event') return { eventStartAt: zonedToUtc(`${day}${DEFAULT_TIME}`, timeZone) }

  if (item.calendarDate === day) return null
  const local = utcToZoned(item.scheduledAt, timeZone)
  return { scheduledAt: zonedToUtc(`${day}${local ? local.slice(10) : DEFAULT_TIME}`, timeZone) }
}

/** The start time to show on a chip, for what happens at a set time. */
export function itemTime(item: CalendarItem, timeZone: string): string {
  if (item.eventAllDay) return ''
  const stored = item.eventStartAt ?? (item.status === 'published' ? item.publishedAt : item.scheduledAt ?? item.publishedAt)
  return utcToZoned(stored, timeZone).slice(11)
}
