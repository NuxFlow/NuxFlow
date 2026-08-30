import { useDb } from '../../../utils/db'
import { menus } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { withEdgeCache } from '../../../utils/edge-cache'

const CACHE_MAX_AGE = 300

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404 })

  const db = useDb(event)
  const location = getRouterParam(event, 'location')!

  // Navigation changes only via the admin menu editor. Cached at the edge (Cloudflare
  // Cache API) — TTL-only, no explicit invalidation, matching the Cache-Control window
  // below.
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
    const menu = await db.query.menus.findFirst({
      where: and(eq(menus.siteId, siteId), eq(menus.location, location)),
      columns: { id: true, name: true, items: true },
    })
    return menu ?? null
  })
})
