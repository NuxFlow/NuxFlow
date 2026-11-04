import { eventDay, floatingDate, type IcsEvent } from '@nuxflow/canvas/events'
import { and, eq, gte, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { contentItems } from '@nuxflow/db/schema'

/** Where a single event's calendar file is served (routes/_nuxflow/event-ics/[id].ts). */
export function eventIcsPath(id: string): string {
  return `/_nuxflow/event-ics/${id}`
}

/** The last moment an event covers, as stored: its end, or its start when it has none. */
export const lastEventDate = sql`coalesce(${contentItems.eventEndAt}, ${contentItems.eventStartAt})`

/**
 * Events still on, or over, at `now`. A multi-day event stays upcoming until its end has
 * passed. An all-day event's dates are midnight UTC, so it's compared with today's date in
 * the site's time zone and stays up through its last day.
 */
export function eventTimeframe(which: 'upcoming' | 'past', now: Date, timeZone: string): SQL {
  const nowIso = now.toISOString()
  const today = floatingDate(eventDay(nowIso, false, timeZone))
  const notAllDay = or(isNull(contentItems.eventAllDay), eq(contentItems.eventAllDay, false))
  const compare = which === 'upcoming' ? gte : lt
  return or(
    and(eq(contentItems.eventAllDay, true), compare(lastEventDate, today)),
    and(notAllDay, compare(lastEventDate, nowIso)),
  )!
}

/** What a calendar file needs from a row, with the link pointing at the event's own page. */
export function toIcsEvent(
  row: { id: string; title: string; excerpt: string | null; eventStartAt: string | null; eventEndAt: string | null; eventAllDay: boolean | null; eventLocation: string | null; eventUrl: string | null; updatedAt: string | null },
  pageUrl: string,
): IcsEvent {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    eventStartAt: row.eventStartAt ?? '',
    eventEndAt: row.eventEndAt,
    eventAllDay: row.eventAllDay,
    eventLocation: row.eventLocation,
    url: pageUrl || row.eventUrl,
    updatedAt: row.updatedAt,
  }
}
