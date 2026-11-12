import { z } from 'zod'
import { useReplicaDb } from '../../utils/db'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { withEdgeCache } from '../../utils/edge-cache'
import { parsePagination } from '../../utils/pagination'
import { getPublicItemsForTerms, listPublicItems, resolvePublicTermFilter } from '../../utils/taxonomy'
import { requireSiteId } from '../../utils/site-context'
import { parseQuery } from '../../utils/validate'
import { fieldFilterConditions, fieldSortOrder, publicFilterDefs } from '../../utils/field-filters'
import { pageDetails, parseFieldDefs } from '../../../shared/lib/custom-fields'
import type { PostsResponse } from '../../../shared/lib/listing-types'

const CACHE_MAX_AGE = 300
/** How many of an item's details a listing card shows. */
const CARD_DETAILS = 4

const querySchema = z.object({
  // Content type slug filter (e.g. `post`); omitted = every type, as before.
  type: z.string().max(100).optional(),
  // Both or neither: a taxonomy archive filter, sub-terms included.
  taxonomy: z.string().max(100).optional(),
  term: z.string().max(200).optional(),
  // A number field to sort by: `f.price` (low first) or `-f.price` (high first).
  sort: z.string().max(60).optional(),
})

// The `f.<key>…` custom-field filters (field-filters.ts), kept apart from the fixed parameters.
const filterParamsSchema = z.record(z.string(), z.unknown()).transform(q => Object.fromEntries(
  Object.entries(q).filter(([k, v]) => k.startsWith('f.') && k.length <= 60 && typeof v === 'string' && v.length <= 500) as [string, string][],
))

export default defineEventHandler(async (event) => {
  // Anonymous, read-only, already edge-cached — safe to read from a D1 read replica when
  // one is enabled (see the "D1 read replication" note on useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)
  const siteId = requireSiteId(event)
  const { page, perPage: limit, offset } = parsePagination(getQuery(event), 10, 50)
  const query = parseQuery(event, querySchema)
  const filterParams = parseQuery(event, filterParamsSchema)

  // Cached at the edge (Cloudflare Cache API) — content writes purge the unparameterized
  // URL; filtered/paginated variants ride out this short TTL.
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
    // A single type's listing can be filtered and sorted by its custom fields, and its cards
    // show their details.
    const type = query.type
      ? await db.query.contentTypes.findFirst({ where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, query.type)), columns: { id: true, schema: true } })
      : null
    const defs = parseFieldDefs(type?.schema)
    const typeFilter = query.type ? inArray(contentItems.typeId, type ? [type.id] : []) : undefined
    const fieldFilter = defs.length ? and(...fieldFilterConditions(defs, filterParams)) : undefined
    const extra = and(typeFilter, fieldFilter)
    const order = defs.length ? fieldSortOrder(defs, query.sort) : undefined

    let result
    if (query.taxonomy && query.term) {
      const resolved = await resolvePublicTermFilter(db, siteId, query.taxonomy, query.term)
      result = resolved
        ? await getPublicItemsForTerms(db, siteId, resolved.termIds, { limit, offset, order, withFields: defs.length > 0 }, extra)
        : { items: [], total: 0 }
    } else {
      result = await listPublicItems(db, siteId, extra, { limit, offset, order, withFields: defs.length > 0 })
    }

    const posts = result.items.map(({ fields, ...item }) => ({
      ...item,
      ...(defs.length ? { details: pageDetails(defs, fields).slice(0, CARD_DETAILS).map(({ key, label, text }) => ({ key, label, text })) } : {}),
    }))
    return {
      posts,
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
      // The filters a listing of this type offers (the Posts block's "Show filters").
      ...(defs.length ? { filters: publicFilterDefs(defs) } : {}),
    } satisfies PostsResponse
  })
})
