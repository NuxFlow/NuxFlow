import { z } from 'zod'
import { useReplicaDb } from '../../utils/db'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { withEdgeCache } from '../../utils/edge-cache'
import { parsePagination } from '../../utils/pagination'
import { getPublicItemsForTerms, listPublicItems, resolvePublicTermFilter } from '../../utils/taxonomy'

const CACHE_MAX_AGE = 300

const querySchema = z.object({
  // Content type slug filter (e.g. `post`); omitted = every type, as before.
  type: z.string().max(100).optional(),
  // Both or neither: a taxonomy archive filter, sub-terms included.
  taxonomy: z.string().max(100).optional(),
  term: z.string().max(200).optional(),
})

export default defineEventHandler(async (event) => {
  // Anonymous, read-only, already edge-cached — safe to read from a D1 read replica when
  // one is enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string
  const rawQuery = getQuery(event)
  const { page, perPage: limit, offset } = parsePagination(rawQuery, 10, 50)
  const parsed = querySchema.safeParse(rawQuery)
  if (!parsed.success) validationError('Validation error', parsed.error.flatten())
  const query = parsed.data

  // Cached at the edge (Cloudflare Cache API) — content writes purge the unparameterized
  // URL; filtered/paginated variants ride out this short TTL.
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
    const typeFilter = query.type
      ? inArray(contentItems.typeId, db.select({ id: contentTypes.id }).from(contentTypes)
          .where(and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, query.type))))
      : undefined

    let result
    if (query.taxonomy && query.term) {
      const resolved = await resolvePublicTermFilter(db, siteId, query.taxonomy, query.term)
      result = resolved
        ? await getPublicItemsForTerms(db, siteId, resolved.termIds, { limit, offset }, typeFilter)
        : { items: [], total: 0 }
    } else {
      result = await listPublicItems(db, siteId, typeFilter, { limit, offset })
    }

    return { posts: result.items, total: result.total, page, limit, totalPages: Math.ceil(result.total / limit) }
  })
})
