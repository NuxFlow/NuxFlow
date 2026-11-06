import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or } from 'drizzle-orm'
import { eventRsvps, sites } from '@nuxflow/db/schema'
import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { expireHold, sendBookingReminder, type RsvpRow } from '../utils/event-rsvp'
import type { ScheduledCloudflareContext } from './publish-scheduled'

/** Most bookings handled per run. Whatever's left waits for the next hour. */
const BATCH = 200

/** How far ahead of a date its reminder goes out. */
const REMINDER_MS = 24 * 3_600_000

/**
 * Hourly, across every site: places kept for someone whose time has run out go to the next
 * person (the seats stopped counting the moment the time was up, so this is about telling
 * people and moving the waitlist), and the day-before reminders go out.
 */
export async function sweepEventBookings(cloudflare?: ScheduledCloudflareContext) {
  const db = useDb()
  const now = new Date()
  const nowIso = now.toISOString()

  // A suspended site changes nothing, and a site being moved does its work once it arrives.
  const closed = db.select({ id: sites.id }).from(sites).where(or(eq(sites.status, 'suspended'), isNotNull(sites.moveState)))

  const [lapsed, reminders] = await Promise.all([
    db.query.eventRsvps.findMany({
      where: and(
        inArray(eventRsvps.status, ['held', 'offered']),
        lt(eventRsvps.holdExpiresAt, nowIso),
        notInArray(eventRsvps.siteId, closed),
      ),
      orderBy: [asc(eventRsvps.holdExpiresAt)],
      limit: BATCH,
    }),
    db.query.eventRsvps.findMany({
      where: and(
        eq(eventRsvps.status, 'confirmed'),
        isNull(eventRsvps.reminderSentAt),
        gte(eventRsvps.startsAt, nowIso),
        lte(eventRsvps.startsAt, new Date(now.getTime() + REMINDER_MS).toISOString()),
        notInArray(eventRsvps.siteId, closed),
      ),
      orderBy: [asc(eventRsvps.startsAt)],
      limit: BATCH,
    }),
  ])
  if (lapsed.length === 0 && reminders.length === 0) return { expired: 0, reminded: 0 }

  const siteIds = [...new Set([...lapsed, ...reminders].map(r => r.siteId))]
  const domains = new Map((await db.query.sites.findMany({
    where: inArray(sites.id, siteIds.slice(0, 90)),
    columns: { id: true, domain: true },
  })).map(s => [s.id, s.domain]))

  const eventFor = (siteId: string) => {
    const domain = domains.get(siteId)
    if (!domain) return null
    const event = createSystemEvent({ env: cloudflare?.env ?? globalThis.__env__, ctx: cloudflare?.context, siteId, host: domain })
    event.context.publicOrigin = `https://${domain}`
    return event
  }

  const each = async (rows: RsvpRow[], work: (event: NonNullable<ReturnType<typeof eventFor>>, row: RsvpRow) => Promise<void>) => {
    let done = 0
    for (const row of rows) {
      const event = eventFor(row.siteId)
      if (!event) continue
      // One bad address or event must not stop everyone else's.
      await work(event, row).then(() => { done++ }).catch(err => console.error(`[event-bookings] Booking ${row.id} failed:`, err))
    }
    return done
  }

  return {
    expired: await each(lapsed, expireHold),
    reminded: await each(reminders, sendBookingReminder),
  }
}
