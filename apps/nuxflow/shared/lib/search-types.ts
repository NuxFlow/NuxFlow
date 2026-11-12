// Site search: what GET /api/v1/search and /api/v1/search/semantic send (/search page).
// Import-free.

/** A piece of a result's excerpt; `highlighted` pieces matched the search. Always plain text. */
export interface SearchExcerptSegment {
  text: string
  highlighted: boolean
}

export interface SearchResult {
  id: string
  title: string
  excerptSegments: SearchExcerptSegment[]
  /** The item's public address; null if it couldn't be worked out. */
  path: string | null
}

export interface SearchResponse {
  results: SearchResult[]
}

export interface SemanticResult {
  id: string
  title: string
  score: number
  path: string | null
}

export interface SemanticResponse {
  /** False when semantic search isn't set up (no Vectorize index or AI). */
  available: boolean
  results: SemanticResult[]
}

// ── Super Admin → Database: the smart-search index (searchIndexStatus(),
// server/utils/search-index-rebuild.ts)

/** The automatic re-embedding after the index's model changed. */
export interface SearchIndexRebuild {
  /** The embedding model this rebuild fills the index with. */
  model: string
  status: 'running' | 'done'
  /** Last content item id done (ids are ULIDs, so this walks them in order). */
  cursor: string | null
  processed: number
  startedAt: string
  finishedAt?: string
  lastError?: string
}

export type SearchIndexStatus =
  | { available: false }
  | {
      available: true
      dimensions: number | null
      model: string | null
      multilingual: boolean
      vectorCount: number | null
      indexablePages: number
      /** Null when no rebuild for the current model has started. */
      rebuild: SearchIndexRebuild | null
    }
