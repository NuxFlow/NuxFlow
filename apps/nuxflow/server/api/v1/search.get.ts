import { z } from 'zod'
import { useReplicaDb } from '../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { rateLimit } from '../../utils/rate-limit'
import { parseQuery } from '../../utils/validate'
import { withPublicPaths } from '../../utils/seo'
import { requireSiteId } from '../../utils/site-context'
import { searchIndex } from '../../utils/search'

export interface SearchExcerptSegment {
  text: string
  highlighted: boolean
}

const querySchema = z.object({ q: z.string().optional() })

// Splits an FTS5 snippet() result on the literal <mark>/</mark> delimiters we
// asked it to insert, so the frontend can render each piece as plain text
// (auto-escaped) instead of trusting the whole string as HTML. The excerpt is
// author-controlled content (excerpt / seo_description) — rendering it as raw
// HTML would let any author-role account plant a stored XSS payload that fires
// for every visitor who searches a matching term.
function parseSnippet(snippet: string): SearchExcerptSegment[] {
  const segments: SearchExcerptSegment[] = []
  let highlighted = false
  for (const part of snippet.split(/(<mark>|<\/mark>)/)) {
    if (part === '<mark>') { highlighted = true; continue }
    if (part === '</mark>') { highlighted = false; continue }
    if (part) segments.push({ text: part, highlighted })
  }
  return segments
}

export default defineEventHandler(async (event) => {
  // Unauthenticated and hits D1 directly on every request (no edge cache, since results
  // are query-dependent). 60/minute per IP is generous for real interactive search usage
  // while still bounding a scripted flood against D1.
  await rateLimit(event, { limit: 60, windowMs: 60_000, keyPrefix: 'search' })

  const siteId = requireSiteId(event)
  const q = parseQuery(event, querySchema).q?.trim()

  if (!q || q.length < 2 || q.length > 200) return { results: [] }

  // Unauthenticated, read-only and uncached — the ideal case for a D1 read replica when
  // one is enabled (see useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)

  const hits = await searchIndex(db, siteId, q, 20)
  if (!hits.length) return { results: [] }

  const ids = hits.map(h => h.contentItemId)
  const items = await db
    .select({ id: contentItems.id, slug: contentItems.slug, locale: contentItems.locale, sourceItemId: contentItems.sourceItemId })
    .from(contentItems)
    .where(and(eq(contentItems.siteId, siteId), inArray(contentItems.id, ids)))
  const pathById = new Map((await withPublicPaths(db, siteId, items)).map(i => [i.id, i.path]))

  const results = hits.map(h => ({
    id: h.contentItemId,
    title: h.title,
    excerptSegments: parseSnippet(h.excerpt),
    path: pathById.get(h.contentItemId) ?? null,
  }))

  return { results }
})
