import { useDb } from '../../utils/db'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { withEdgeCache } from '../../utils/edge-cache'

const CACHE_MAX_AGE = 60

// Public, unauthenticated plugin listing for the client-side block registry
// (dynamic-plugins.client.ts) — every visitor needs this, not just admins, since
// Canvas pages with dynamic-plugin blocks render for anyone. Deliberately narrow:
// never returns checksums, signature, or publisherPublicKey — those stay behind
// the admin-only GET /api/v1/dynamic-plugins used by the plugin management page.
export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) return { plugins: [] }

  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=300`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
    const db = useDb(event)
    const rows = await db.query.dynamicPlugins.findMany({
      where: eq(dynamicPlugins.siteId, siteId),
      columns: { id: true, isActive: true, hasClient: true, blockDefinitions: true },
    })

    return {
      plugins: rows.map(r => ({
        id: r.id,
        isActive: r.isActive,
        hasClient: r.hasClient,
        blockDefinitions: r.blockDefinitions ?? [],
      })),
    }
  })
})
