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
