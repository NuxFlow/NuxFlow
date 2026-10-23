import { sql } from 'drizzle-orm'
import type { Db } from './db'

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

/**
 * The rows of a raw `db.run()` result. D1 returns `{ results }`; the libSQL driver the
 * integration tests use returns `{ rows }`.
 */
export function rawRows(result: unknown): Record<string, unknown>[] {
  const raw = result as { rows?: unknown[]; results?: unknown[] }
  return (raw.rows ?? raw.results ?? []) as Record<string, unknown>[]
}

export interface SearchIndexHit {
  contentItemId: string
  title: string
  /** FTS5 snippet with literal <mark>…</mark> around matches — never render it as HTML. */
  excerpt: string
}

/**
 * Keyword search over a site's `search_index` (published, public items only — see
 * migrations/0001_search_index.sql), best match first. Returns [] when `text` has nothing
 * searchable.
 */
export async function searchIndex(db: Db, siteId: string, text: string, limit: number): Promise<SearchIndexHit[]> {
  const match = toFtsQuery(text)
  if (!match) return []
  const result = await db.run(sql`
    SELECT content_item_id, title, snippet(search_index, 3, '<mark>', '</mark>', '…', 20) AS excerpt
    FROM search_index
    WHERE search_index MATCH ${match}
      AND site_id = ${siteId}
    ORDER BY rank
    LIMIT ${limit}
  `)
  return rawRows(result).map(r => ({
    contentItemId: String(r.content_item_id ?? ''),
    title: String(r.title ?? ''),
    excerpt: String(r.excerpt ?? ''),
  }))
}
