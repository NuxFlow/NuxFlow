import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { contentTypes } from '@nuxflow/db/schema'
import { eventDay, floatingDate, parseStoredDate } from '@nuxflow/canvas/events'
import type { Db } from './db'

// The date rules every path that writes content goes through (REST create/update, MCP),
// so an event can't go live with no date or end before it starts, and "scheduled" always
// means there is a date to publish on.

const instant = z.string().datetime({ offset: true, message: 'Expected an ISO 8601 date and time' })

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')

/** Largest number of places an event can offer. */
export const RSVP_MAX_CAPACITY = 100_000

export const contentDateFields = {
  scheduledAt: instant.nullish(),
  eventStartAt: instant.nullish(),
  eventEndAt: instant.nullish(),
  eventLocation: z.string().max(500).nullish(),
  // Rendered as a link and written to calendar files, so never a javascript: address.
  eventUrl: z.string().max(2048).regex(/^https?:\/\/\S+$/i, 'The event link must start with https://').nullish(),
  eventAllDay: z.boolean().nullish(),
  eventRsvpEnabled: z.boolean().nullish(),
  eventRsvpCapacity: z.number().int().min(1).max(RSVP_MAX_CAPACITY).nullish(),
  eventRsvpClosesAt: instant.nullish(),
  eventRecurrence: z.object({
    freq: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().int().min(1).max(52),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    until: day.nullish(),
    skip: z.array(day).max(500).optional(),
  }).nullish(),
  // Up to Stripe's own limit on a single charge, near enough.
  eventPrice: z.number().min(0).max(999_999).nullish(),
  eventCurrency: z.string().regex(/^[a-z]{3}$/i, 'Use a three-letter currency code, such as GBP').transform(c => c.toUpperCase()).nullish(),
  eventCancelHours: z.number().int().min(0).max(8760).nullish(),
  eventPassesAllowed: z.boolean().nullish(),
}

export interface ContentDateValues {
  status?: string | null
  scheduledAt?: string | null
  eventStartAt?: string | null
  eventEndAt?: string | null
  eventAllDay?: boolean | null
  eventRecurrence?: { until?: string | null } | null
}

export interface ContentDateContext {
  /** The stored item on an update, null on a create. */
  existing: (ContentDateValues & { typeId: string; sourceItemId?: string | null }) | null
  /** The item's content type, when the caller already has it. */
  typeSlug?: string
  /** A translation takes its dates from its original, so it may have none of its own. */
  sourceItemId?: string | null
  timeZone: string
}

const LIVE_STATUSES = new Set(['published', 'scheduled'])

/**
 * Checks a write's dates against what's stored. Returns what's wrong in words the author
 * can act on, or the event dates to store: an all-day event's are normalised to its date
 * at midnight UTC. Rules about going live only apply when the write changes something, so
 * editing an older live event that breaks them isn't refused.
 */
export async function checkContentDates(db: Db, siteId: string, input: ContentDateValues, context: ContentDateContext): Promise<
  { problem: string; dates?: undefined } | { problem?: undefined; dates: Pick<ContentDateValues, 'eventStartAt' | 'eventEndAt'> }
> {
  const { existing, timeZone } = context
  const merged = <K extends keyof ContentDateValues>(key: K): ContentDateValues[K] | undefined =>
    input[key] !== undefined ? input[key] : existing?.[key]

  const status = merged('status')
  const scheduledAt = merged('scheduledAt')
  const allDay = merged('eventAllDay')
  let start = merged('eventStartAt') ?? null
  let end = merged('eventEndAt') ?? null
  const dates: Pick<ContentDateValues, 'eventStartAt' | 'eventEndAt'> = {}

  const touched = input.eventStartAt !== undefined || input.eventEndAt !== undefined || input.eventAllDay !== undefined
  if (touched) {
    if (end && !start) return { problem: 'Add a start date for this event.' }
    if (allDay && start) {
      start = floatingDate(eventDay(start, true, timeZone))
      if (end) end = floatingDate(eventDay(end, true, timeZone))
    }
    const startDate = parseStoredDate(start)
    const endDate = parseStoredDate(end)
    if (startDate && endDate && endDate < startDate) return { problem: 'The event can\'t end before it starts.' }
    dates.eventStartAt = start
    dates.eventEndAt = end
  }

  const recurrence = merged('eventRecurrence')
  if (recurrence) {
    if (!start) return { problem: 'Add a start date for this event before making it repeat.' }
    const first = eventDay(start, allDay, timeZone)
    if (recurrence.until && first && recurrence.until < first) return { problem: 'The last date can\'t be before the first one.' }
  }

  const statusChanged = existing?.status !== status
  if (status === 'scheduled' && !scheduledAt && (statusChanged || existing?.scheduledAt)) {
    return { problem: 'Pick a date and time to schedule this for.' }
  }

  const goingLive = status != null && LIVE_STATUSES.has(status)
    && (statusChanged || Boolean(existing?.eventStartAt && !start))
  if (goingLive && !start && !(context.sourceItemId ?? existing?.sourceItemId)) {
    const slug = context.typeSlug ?? (existing
      ? (await db.query.contentTypes.findFirst({
          where: and(eq(contentTypes.id, existing.typeId), eq(contentTypes.siteId, siteId)),
          columns: { slug: true },
        }))?.slug
      : undefined)
    if (slug === 'event') return { problem: 'Add a start date before publishing this event.' }
  }

  return { dates }
}
