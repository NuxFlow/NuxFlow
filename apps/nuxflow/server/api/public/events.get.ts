import { useDb } from '../../utils/db'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq, gte, lte, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  if (!siteId) throw createError({ statusCode: 404 })

  const query = getQuery(event)
  const from = (query.from as string) || new Date().toISOString()
  const to = query.to as string | undefined
  const limit = Math.min(100, parseInt(query.limit as string || '20'))
  const offset = parseInt(query.offset as string || '0')

  // Find the event content type ID
  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, 'event')),
    columns: { id: true },
  })
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
})
