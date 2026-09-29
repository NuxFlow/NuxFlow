import { useReplicaDb } from '../../../../utils/db'
import { taxonomies } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { withEdgeCache } from '../../../../utils/edge-cache'
import { getPublicTermCounts } from '../../../../utils/taxonomy'

const CACHE_MAX_AGE = 300

// Overview page data for /{taxonomy}: every term that lists at least one published,
// public item (directly or through a sub-term), with counts. Lives at index.get.ts inside
// the [taxonomySlug]/ folder rather than as a sibling [taxonomySlug].get.ts file, which
// is the flat-file-beside-folder pattern CLAUDE.md warns trips Nitro's $fetch typing.
export default defineEventHandler(async (event) => {
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string
  const taxonomySlug = getRouterParam(event, 'taxonomySlug')!

  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
    const taxonomy = await db.query.taxonomies.findFirst({
      where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, taxonomySlug)),
      columns: { id: true, slug: true, name: true, description: true, isHierarchical: true, noindex: true },
    })
    if (!taxonomy) throw notFound('Taxonomy not found')

    const terms = (await getPublicTermCounts(db, siteId, taxonomy.id)).filter(t => t.total > 0)
    const { id: _id, ...rest } = taxonomy
    return { taxonomy: rest, terms }
  })
})
