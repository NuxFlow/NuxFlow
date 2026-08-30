import { useDb } from '../../../../utils/db'
import { taxonomyTerms, taxonomies } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { getItemsForTerm } from '@nuxflow/db/queries'
import { withEdgeCache } from '../../../../utils/edge-cache'

const CACHE_MAX_AGE = 300

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomySlug = getRouterParam(event, 'taxonomySlug')!
  const termSlug = getRouterParam(event, 'termSlug')!
  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 10))
  const offset = (page - 1) * limit

  // Cached at the edge (Cloudflare Cache API) — TTL-only, no explicit invalidation,
  // matching the same window this route already promises via Cache-Control below.
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
    const taxonomy = await db.query.taxonomies.findFirst({
      where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, taxonomySlug)),
      columns: { id: true, name: true, slug: true },
    })
    if (!taxonomy) throw notFound('Taxonomy not found')

    const term = await db.query.taxonomyTerms.findFirst({
      where: and(eq(taxonomyTerms.taxonomyId, taxonomy.id), eq(taxonomyTerms.slug, termSlug)),
      columns: { id: true, name: true, slug: true, description: true },
    })
    if (!term) throw notFound('Term not found')

    const { items, total } = await getItemsForTerm(db, siteId, term.id, { limit, offset })

    return { taxonomy, term, items, total, page, limit, totalPages: Math.ceil(total / limit) }
  })
})
