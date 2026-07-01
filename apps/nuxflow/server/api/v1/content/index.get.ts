import { useDb } from '../../../utils/db'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq, desc, gt } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const typeSlug = (query.type as string) || 'page'

  // Determine if request is authenticated (session or API key)
  const session = await getUserSession(event)
  const apiKeyUserId = event.context.apiKeyUserId as string | undefined
  const isAuthenticated = Boolean(session || apiKeyUserId)

  const type = await db.query.contentTypes.findFirst({
    where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, typeSlug)),
  })
  if (!type) throw createError({ statusCode: 404, message: `Content type "${typeSlug}" not found` })

  const conditions = [eq(contentItems.siteId, siteId), eq(contentItems.typeId, type.id)]

  // Unauthenticated requests (public/API-key-only) see only published content
  if (!isAuthenticated) {
    conditions.push(eq(contentItems.status, 'published'))
  } else if (query.status) {
    conditions.push(eq(contentItems.status, query.status as 'draft' | 'review' | 'published' | 'scheduled' | 'archived'))
  }

  // Filter by locale
  if (query.locale) {
    conditions.push(eq(contentItems.locale, query.locale as string))
  }

  // Delta sync: return only items modified after a given timestamp.
  // Used by offline clients on reconnect to fetch only what changed.
  // Hits idx_content_items_site_updated (site_id, updated_at) index.
  if (query.updatedAfter) {
    conditions.push(gt(contentItems.updatedAt, query.updatedAfter as string))
  }

  const items = await db.query.contentItems.findMany({
    where: and(...conditions),
    orderBy: [desc(contentItems.updatedAt)],
    columns: {
      id: true, title: true, slug: true, status: true, publishedAt: true, updatedAt: true, authorId: true, version: true, locale: true, sourceItemId: true,
    },
  })

  return { items, type }
})
