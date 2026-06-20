import { useDb } from '../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, desc, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 10))
  const offset = (page - 1) * limit

  const where = and(
    eq(contentItems.siteId, siteId),
    eq(contentItems.status, 'published'),
    eq(contentItems.visibility, 'public'),
  )

  const [countResult] = await db
    .select({ total: sql<number>`count(*)` })
    .from(contentItems)
    .where(where)

  const total = countResult?.total ?? 0

  const posts = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      slug: contentItems.slug,
      excerpt: contentItems.excerpt,
      ogImage: contentItems.ogImage,
      publishedAt: contentItems.publishedAt,
    })
    .from(contentItems)
    .where(where)
    .orderBy(desc(contentItems.publishedAt))
    .limit(limit)
    .offset(offset)

  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  return { posts, total, page, limit, totalPages: Math.ceil(total / limit) }
})
