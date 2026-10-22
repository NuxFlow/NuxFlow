import { z } from 'zod'
import { useReplicaDb } from '../../utils/db'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { rateLimit } from '../../utils/rate-limit'
import { parseQuery } from '../../utils/validate'
import { withPublicPaths } from '../../utils/seo'

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

/**
 * Builds an FTS5 MATCH expression from free text: every run of letters/digits (any
 * script) becomes a quoted prefix term, and the terms are ANDed. Quoting keeps FTS5
 * syntax (AND, NEAR, *, quotes) typed by a visitor from ever reaching the parser.
 * Returns null when the text has no searchable characters.
 */
export function toFtsQuery(text: string): string | null {
  const terms = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 10)
  if (!terms?.length) return null
  return terms.map(t => `"${t}"*`).join(' ')
}

export default defineEventHandler(async (event) => {
  // Unauthenticated and hits D1 directly on every request (no edge cache, since results
  // are query-dependent). 60/minute per IP is generous for real interactive search usage
  // while still bounding a scripted flood against D1.
  await rateLimit(event, { limit: 60, windowMs: 60_000, keyPrefix: 'search' })

  const siteId = event.context.siteId as string
  const q = parseQuery(event, querySchema).q?.trim()

  if (!q || q.length < 2 || q.length > 200) return { results: [] }
  const match = toFtsQuery(q)
  if (!match) return { results: [] }

  // Unauthenticated, read-only and uncached — the ideal case for a D1 read replica when
  // one is enabled (see useReplicaDb in server/utils/db.ts).
  const db = useReplicaDb(event)

  const rawResults = await db.run(sql`
    SELECT content_item_id, title, snippet(search_index, 3, '<mark>', '</mark>', '…', 20) AS excerpt
    FROM search_index
    WHERE search_index MATCH ${match}
      AND site_id = ${siteId}
    ORDER BY rank
    LIMIT 20
  `)

  // D1 returns { results: [{...}] }; the libSQL driver the integration tests use returns { rows }.
  const raw = rawResults as unknown as { rows?: unknown[]; results?: unknown[] }
  const rows = (raw.rows ?? raw.results ?? []) as Record<string, unknown>[]

  if (!rows.length) return { results: [] }

  const ids = rows.map(r => String(r.content_item_id ?? ''))
  const items = await db
    .select({ id: contentItems.id, slug: contentItems.slug, locale: contentItems.locale, sourceItemId: contentItems.sourceItemId })
    .from(contentItems)
    .where(and(eq(contentItems.siteId, siteId), inArray(contentItems.id, ids)))
  const pathById = new Map((await withPublicPaths(db, siteId, items)).map(i => [i.id, i.path]))

  const results = rows.map(r => ({
    id: String(r.content_item_id ?? ''),
    title: String(r.title ?? ''),
    excerptSegments: parseSnippet(String(r.excerpt ?? '')),
    path: pathById.get(String(r.content_item_id ?? '')) ?? null,
  }))

  return { results }
})
