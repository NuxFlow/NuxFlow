import { useReplicaDb } from '../../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { inArray } from 'drizzle-orm'
import { rateLimit } from '../../../utils/rate-limit'
import { semanticSearch } from '../../../utils/embeddings'

/**
 * Semantic (vector) search — a supplement to FTS5 keyword search (search.get.ts), not a
 * replacement (see CLAUDE.md's Search section). Same public, unauthenticated, rate-limited
 * shape as search.get.ts, and the same content-visibility scope: only published/public
 * content items ever get a vector (see upsertContentEmbedding in embeddings.ts), so this
 * route needs no extra access check beyond what already gates the vectors' existence.
 * Returns `{ available: false }` when no Vectorize index is configured (it's opt-in — see
 * wrangler.toml.example) so the frontend can hide the "semantic search" option entirely
 * rather than show a search box that always returns zero results.
 */
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 60, windowMs: 60_000, keyPrefix: 'search-semantic' })

  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const q = (query.q as string)?.trim()

  if (!q || q.length < 2 || q.length > 500) return { available: true, results: [] }

  const matches = await semanticSearch(event, siteId, q, 10)
  if (matches === null) return { available: false, results: [] }
  if (!matches.length) return { available: true, results: [] }

  const db = useReplicaDb(event)
  const ids = matches.map(m => m.contentItemId)
  const items = await db
    .select({ id: contentItems.id, slug: contentItems.slug })
    .from(contentItems)
    .where(inArray(contentItems.id, ids))
  const slugMap = new Map(items.map(i => [i.id, i.slug]))

  const results = matches.map(m => ({
    id: m.contentItemId,
    title: m.title ?? '',
    score: m.score,
    slug: slugMap.get(m.contentItemId) ?? null,
  })).filter(r => r.slug !== null) // a matched vector whose content item was since deleted

  return { available: true, results }
})
