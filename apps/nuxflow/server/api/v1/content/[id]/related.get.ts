import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { semanticSearch } from '../../../../utils/embeddings'
import { contentItems } from '@nuxflow/db/schema'
import { inArray } from 'drizzle-orm'

/**
 * Semantic "related content" suggestions for the editor sidebar — internal linking and
 * duplicate/overlapping-content awareness, using the same Vectorize infrastructure as
 * search/semantic.get.ts. Editor-only (requireAuth, matching content/[id].get.ts's own
 * floor) rather than public — unlike the public search route, this uses the *current* item's
 * own title/excerpt as the query, which the editor is already authorized to read regardless
 * of the item's publish status, so it stays behind the same auth boundary as the editor page.
 */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const item = await getContentItemOrThrow(db, siteId, id, 'Not found', { title: true, excerpt: true, seoDescription: true })

  const queryText = `${item.title}\n\n${item.excerpt || item.seoDescription || ''}`.trim()
  if (!queryText) return { available: true, results: [] }

  // Over-fetch slightly and drop the item itself (a published item's own vector is a
  // near-perfect match for its own title/excerpt) rather than asking Vectorize for topK+1.
  const matches = await semanticSearch(event, siteId, queryText, 6)
  if (matches === null) return { available: false, results: [] }

  const filtered = matches.filter(m => m.contentItemId !== id).slice(0, 5)
  if (!filtered.length) return { available: true, results: [] }

  const ids = filtered.map(m => m.contentItemId)
  const rows = await db
    .select({ id: contentItems.id, title: contentItems.title, slug: contentItems.slug })
    .from(contentItems)
    .where(inArray(contentItems.id, ids))
  const rowMap = new Map(rows.map(r => [r.id, r]))

  const results = filtered
    .map(m => ({ ...rowMap.get(m.contentItemId), score: m.score }))
    .filter((r): r is { id: string; title: string; slug: string; score: number } => Boolean(r.id))

  return { available: true, results }
})
