import { useDb } from '../../../utils/db'
import { canEditContentItem, requireRole } from '../../../utils/permissions'
import { parseQuery } from '../../../utils/validate'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'
import { addDays, eventDayRange, floatingDate, utcToZoned } from '@nuxflow/canvas/events'
import { lastEventDate } from '../../../utils/event-feed'
import { requireSiteId } from '../../../utils/site-context'
import { getSiteInfo } from '../../../utils/site-info'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
})

/** Most undated drafts listed beside the calendar, newest first. */
const UNSCHEDULED_LIMIT = 100

const COLUMNS = {
  id: true,
  title: true,
  slug: true,
  status: true,
  typeId: true,
  authorId: true,
  sourceItemId: true,
  version: true,
  publishedAt: true,
  scheduledAt: true,
  eventStartAt: true,
  eventEndAt: true,
  eventAllDay: true,
  eventLocation: true,
} as const

export default defineEventHandler(async (event) => {
  const { userId, role } = await requireRole(event, 'viewer')

  const db = useDb(event)
  const siteId = requireSiteId(event)
  const { from, to } = parseQuery(event, querySchema)
  const timeZone = (await getSiteInfo(event, siteId))?.timezone || 'UTC'

  // Days are the site's own, and stored dates come in two text forms ("…T09:00:00.000Z" and
  // "… 09:00:00") that don't compare exactly. So this reads a day either side, which covers
  // every time zone and both forms, and the exact day is worked out below.
  const fromTs = floatingDate(addDays(from, -1))
  const toTs = floatingDate(addDays(to, 2))

  // Independent queries — types doesn't filter rows (typeId is just mapped in afterward).
  const [types, rows, undated] = await Promise.all([
    db.query.contentTypes.findMany({
      where: eq(contentTypes.siteId, siteId),
      columns: { id: true, slug: true, name: true, icon: true },
    }),
    db.query.contentItems.findMany({
      where: and(
        eq(contentItems.siteId, siteId),
        or(
          and(gte(contentItems.publishedAt, fromTs), lte(contentItems.publishedAt, toTs)),
          and(gte(contentItems.scheduledAt, fromTs), lte(contentItems.scheduledAt, toTs)),
          // Anything overlapping the range, so a long event shows in each month it covers.
          and(lte(contentItems.eventStartAt, toTs), gte(lastEventDate, fromTs)),
        ),
      ),
      columns: COLUMNS,
    }),
    db.query.contentItems.findMany({
      where: and(
        eq(contentItems.siteId, siteId),
        inArray(contentItems.status, ['draft', 'review']),
        isNull(contentItems.publishedAt),
        isNull(contentItems.scheduledAt),
        isNull(contentItems.eventStartAt),
        isNull(contentItems.sourceItemId),
      ),
      orderBy: [desc(contentItems.updatedAt)],
      limit: UNSCHEDULED_LIMIT,
      columns: COLUMNS,
    }),
  ])
  const typeMap = Object.fromEntries(types.map(t => [t.id, t]))

  type Row = (typeof rows)[number]
  const describe = ({ authorId, sourceItemId: _source, ...row }: Row) => ({
    ...row,
    type: typeMap[row.typeId] ?? null,
    canEdit: canEditContentItem(role, userId, { authorId, status: row.status }),
  })

  const items = rows.flatMap((row) => {
    // A translation shares its original's date; it would only be the same event twice.
    if (row.eventStartAt && row.sourceItemId) return []
    const { first, last } = calendarDays(row, timeZone)
    if (!first || first > to || last < from) return []
    return [{ ...describe(row), calendarDate: first, calendarEndDate: last }]
  })

  return { items, unscheduled: undated.map(describe), timeZone }
})

// Events anchor to their dates. Published items anchor to when they went out, anything else
// with a publish date (scheduled, or a planned draft) to that date.
function calendarDays(row: Pick<typeof contentItems.$inferSelect, 'status' | 'publishedAt' | 'scheduledAt' | 'eventStartAt' | 'eventEndAt' | 'eventAllDay'>, timeZone: string): { first: string; last: string } {
  if (row.eventStartAt) {
    const range = eventDayRange({ eventStartAt: row.eventStartAt, eventEndAt: row.eventEndAt, eventAllDay: row.eventAllDay }, timeZone)
    if (range) return range
  }
  const anchor = row.status === 'published' || row.status === 'archived'
    ? row.publishedAt ?? row.scheduledAt
    : row.scheduledAt ?? row.publishedAt
  const day = utcToZoned(anchor, timeZone).slice(0, 10)
  return { first: day, last: day }
}
