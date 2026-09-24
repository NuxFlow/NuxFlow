import { useReplicaDb } from '../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { paginate, countRows } from '@nuxflow/db/queries'
import { withEdgeCache } from '../../utils/edge-cache'
import { parsePagination } from '../../utils/pagination'

const CACHE_MAX_AGE = 300

export default defineEventHandler(async (event) => {
  // Anonymous, read-only, already edge-cached — safe to read from a D1 read replica when
  // one is enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const { page, perPage: limit, offset } = parsePagination(query, 10, 50)

  // Cached at the edge (Cloudflare Cache API) — TTL-only, no explicit invalidation on
  // publish/edit, matching the same window this route already promises via
  // Cache-Control below.
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
    const where = and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.status, 'published'),
      eq(contentItems.visibility, 'public'),
    )

    const { items: posts, total } = await paginate(
      countRows(db, contentItems, where),
      () => db
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
        .offset(offset),
    )

    return { posts, total, page, limit, totalPages: Math.ceil(total / limit) }
  })
})
