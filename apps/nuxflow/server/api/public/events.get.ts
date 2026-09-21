import type { H3Event } from 'h3'
import { useDb } from '../../utils/db'
import { getContentTypeBySlug } from '../../utils/content-queries'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, gte, lte, desc } from 'drizzle-orm'
import { notFound } from '../../utils/response'
import { withEdgeCache } from '../../utils/edge-cache'

async function loadEvents(event: H3Event, siteId: string) {
  const db = useDb(event)
  const query = getQuery(event)
  const from = (query.from as string) || new Date().toISOString()
  const to = query.to as string | undefined
  const limit = Math.min(100, parseInt(query.limit as string || '20'))
  const offset = parseInt(query.offset as string || '0')

  // Find the event content type ID
  const type = await getContentTypeBySlug(db, siteId, 'event', { id: true })
  if (!type) return { events: [] }

  const conditions = [
    eq(contentItems.siteId, siteId),
    eq(contentItems.typeId, type.id),
    eq(contentItems.status, 'published'),
    gte(contentItems.eventStartAt, from)
  ]

  if (to) {
    conditions.push(lte(contentItems.eventStartAt, to))
  }

  const events = await db.query.contentItems.findMany({
    where: and(...conditions),
    orderBy: [desc(contentItems.eventStartAt)],
    limit,
    offset,
  })

  return { events }
}

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  if (!siteId) notFound()

  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  // Fully public, unauthenticated calendar-block data. Short TTL (5 min, not the usual
  // 1h) because an omitted `from` defaults to "now" server-side inside loadEvents — the
  // cached result is only ever as fresh as whichever request first populated the cache
  // for this exact URL, so a short TTL keeps that window tight for the common no-filter case.
  return withEdgeCache(event, 300, () => loadEvents(event, siteId))
})
