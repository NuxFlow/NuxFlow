import { useReplicaDb } from '../../../../utils/db'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { asc, eq } from 'drizzle-orm'
import { withEdgeCache } from '../../../../utils/edge-cache'
import { parsePagination } from '../../../../utils/pagination'
import { getPublicItemsForTerms, getTermAncestors, resolvePublicTermFilter } from '../../../../utils/taxonomy'

const CACHE_MAX_AGE = 300

export default defineEventHandler(async (event) => {
  // Anonymous, read-only, already edge-cached — safe to read from a D1 read replica when
  // one is enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string
  const taxonomySlug = getRouterParam(event, 'taxonomySlug')!
  const termSlug = getRouterParam(event, 'termSlug')!
  const query = getQuery(event)
  const { page, perPage: limit, offset } = parsePagination(query, 10, 50)

  // Cached at the edge (Cloudflare Cache API); term/content writes purge it explicitly
  // (purgeContentCache / purgeTaxonomyCache), the TTL is only the staleness ceiling.
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
    const resolved = await resolvePublicTermFilter(db, siteId, taxonomySlug, termSlug)
    if (!resolved) throw notFound('Term not found')
    const { taxonomy, term, termIds } = resolved

    // A hierarchical term's archive also lists its sub-terms' content (WordPress's
    // category behaviour) — termIds already includes every descendant.
    const [{ items, total }, ancestors, children] = await Promise.all([
      getPublicItemsForTerms(db, siteId, termIds, { limit, offset }),
      taxonomy.isHierarchical ? getTermAncestors(db, taxonomy.id, term.id) : Promise.resolve([]),
      taxonomy.isHierarchical
        ? db.select({ slug: taxonomyTerms.slug, name: taxonomyTerms.name })
            .from(taxonomyTerms)
            .where(eq(taxonomyTerms.parentId, term.id))
            .orderBy(asc(taxonomyTerms.sortOrder), asc(taxonomyTerms.name))
        : Promise.resolve([]),
    ])

    return {
      taxonomy: { id: taxonomy.id, name: taxonomy.name, slug: taxonomy.slug, isHierarchical: taxonomy.isHierarchical, noindex: taxonomy.noindex },
      term: {
        id: term.id,
        name: term.name,
        slug: term.slug,
        description: term.description,
        seoTitle: term.seoTitle,
        seoDescription: term.seoDescription,
        ogImage: term.ogImage,
      },
      ancestors: ancestors.map(a => ({ slug: a.slug, name: a.name })),
      children,
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  })
})
