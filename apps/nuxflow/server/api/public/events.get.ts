import type { H3Event } from 'h3'
import { z } from 'zod'
import { useReplicaDb } from '../../utils/db'
import { parseQuery } from '../../utils/validate'
import { getContentTypeBySlug } from '../../utils/content-queries'
import { contentItems, contentTaxonomyTerms, sites, taxonomies, taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq, gte, lte, asc, desc, inArray, isNotNull, isNull } from 'drizzle-orm'
import { addDays, eventDay, eventHasEnded, todayIn } from '@nuxflow/canvas/events'
import { notFound } from '../../utils/response'
import { withEdgeCache } from '../../utils/edge-cache'
import { eventIcsPath, eventTimeframe, expandSeries, lastEventDate } from '../../utils/event-feed'
import { publicPathForItem } from '../../utils/seo'

// Out-of-range numbers are clamped rather than refused, so a block with an odd setting still renders.
const querySchema = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  // Without from/to: what's on now and next, or (past=1) what has finished, latest first.
  past: z.enum(['0', '1']).catch('0'),
  limit: z.coerce.number().int().catch(20).transform(n => Math.min(100, Math.max(1, n))),
  offset: z.coerce.number().int().catch(0).transform(n => Math.max(0, n)),
  // Adds each event's terms in this taxonomy, for the block's filter (class type, say).
  taxonomy: z.string().max(100).optional(),
})

/** Most repeating events read per request. */
const MAX_SERIES = 100

/** How far ahead "what's next" looks for a series' dates. */
const UPCOMING_DAYS = 120

const COLUMNS = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  eventStartAt: true,
  eventEndAt: true,
  eventAllDay: true,
  eventLocation: true,
  eventUrl: true,
  eventRsvpEnabled: true,
  eventRecurrence: true,
  eventPrice: true,
  eventCurrency: true,
} as const

async function loadEvents(event: H3Event, siteId: string) {
  // Anonymous, read-only and edge-cached — fine to read from a D1 replica.
  const db = useReplicaDb(event)
  const { from, to, past, limit, offset, taxonomy } = parseQuery(event, querySchema)

  // Find the event content type ID
  const [type, site] = await Promise.all([
    getContentTypeBySlug(db, siteId, 'event', { id: true }),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { timezone: true, locale: true } }),
  ])
  if (!type) return { events: [] }
  const timeZone = site?.timezone || 'UTC'

  const conditions = [
    eq(contentItems.siteId, siteId),
    eq(contentItems.typeId, type.id),
    eq(contentItems.status, 'published'),
    // Same rule as every other anonymous surface (posts, feeds, sitemap, taxonomy
    // archives): private/members-only events must not be listed here.
    eq(contentItems.visibility, 'public'),
    // A translation is the same event, not another one.
    isNull(contentItems.sourceItemId),
  ]

  const now = new Date()
  const hasWindow = Boolean(from || to)
  const oneOffs = [...conditions, isNull(contentItems.eventRecurrence)]
  if (hasWindow) {
    // Anything overlapping the window, so a month grid shows a conference that began the month before.
    if (from) oneOffs.push(gte(lastEventDate, from))
    if (to) oneOffs.push(lte(contentItems.eventStartAt, to))
  }
  else {
    oneOffs.push(eventTimeframe(past === '1' ? 'past' : 'upcoming', now, timeZone))
  }

  // Soonest first — this is an "upcoming events" list, so a descending sort plus LIMIT
  // would drop the nearest events once there are more than `limit` of them.
  // Only the fields CanvasBlockCalendar renders: the full row would include the event's
  // body (`content`) and settings, which this anonymous, edge-cached route must not expose.
  const descending = !hasWindow && past === '1'
  const [rows, seriesRows] = await Promise.all([
    db.query.contentItems.findMany({
      where: and(...oneOffs),
      orderBy: [descending ? desc(contentItems.eventStartAt) : asc(contentItems.eventStartAt)],
      // The offset applies after merging with repeating events' dates, below.
      limit: limit + offset,
      columns: COLUMNS,
    }),
    // A finished series' dates aren't a "past events" list anyone wants: its page covers it.
    descending
      ? Promise.resolve([])
      : db.query.contentItems.findMany({
          where: and(...conditions, isNotNull(contentItems.eventRecurrence), to ? lte(contentItems.eventStartAt, to) : undefined),
          limit: MAX_SERIES,
          columns: COLUMNS,
        }),
  ])

  // A day either side covers a date that crosses midnight or a window given in UTC.
  const today = todayIn(timeZone, now)
  const fromDay = from ? eventDay(from, false, timeZone) : addDays(today, -1)
  const toDay = to ? eventDay(to, false, timeZone) : addDays(today, UPCOMING_DAYS)
  const dates = seriesRows.flatMap(row => expandSeries(row, timeZone, fromDay, toDay, limit + offset + 2))
    .filter(row => hasWindow || !eventHasEnded({ eventStartAt: row.eventStartAt, eventEndAt: row.eventEndAt, eventAllDay: row.eventAllDay }, timeZone, now))

  const merged = [...rows.map(row => ({ ...row, date: null as string | null })), ...dates]
    .sort((a, b) => (descending ? -1 : 1) * (a.eventStartAt ?? '').localeCompare(b.eventStartAt ?? ''))
    .slice(offset, offset + limit)

  const termsById = taxonomy ? await loadTerms(db, siteId, taxonomy, [...new Set(merged.map(row => row.id))]) : null
  const locale = site?.locale || 'en'
  const events = merged.map(({ eventRsvpEnabled, eventRecurrence: _rule, eventPrice, eventCurrency, ...row }) => {
    const paid = (eventPrice ?? 0) > 0
    const query = row.date ? `?date=${row.date}` : ''
    return {
      ...row,
      path: `${publicPathForItem({ slug: row.slug }, locale)}${query}`,
      icsUrl: `${eventIcsPath(row.id)}${query}`,
      rsvp: Boolean(eventRsvpEnabled),
      price: paid ? eventPrice : null,
      currency: paid ? eventCurrency || 'USD' : null,
      ...(termsById ? { terms: termsById.get(row.id) ?? [] } : {}),
    }
  })
  return { events, timeZone, feedUrl: '/events.ics' }
}

async function loadTerms(db: ReturnType<typeof useReplicaDb>, siteId: string, taxonomySlug: string, itemIds: string[]) {
  const out = new Map<string, Array<{ slug: string; name: string }>>()
  if (itemIds.length === 0) return out
  const rows = await db
    .select({ itemId: contentTaxonomyTerms.contentItemId, slug: taxonomyTerms.slug, name: taxonomyTerms.name })
    .from(contentTaxonomyTerms)
    .innerJoin(taxonomyTerms, eq(taxonomyTerms.id, contentTaxonomyTerms.termId))
    .innerJoin(taxonomies, eq(taxonomies.id, taxonomyTerms.taxonomyId))
    .where(and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, taxonomySlug), inArray(contentTaxonomyTerms.contentItemId, itemIds.slice(0, 90))))
  for (const row of rows) out.set(row.itemId, [...(out.get(row.itemId) ?? []), { slug: row.slug, name: row.name }])
  return out
}

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId
  if (!siteId) notFound()

  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  // Fully public, unauthenticated calendar-block data. Short TTL (5 min, not the usual
  // 1h) because what counts as "upcoming" moves with the clock — the cached result is only
  // ever as fresh as whichever request first populated the cache for this exact URL.
  return withEdgeCache(event, 300, () => loadEvents(event, siteId))
})
