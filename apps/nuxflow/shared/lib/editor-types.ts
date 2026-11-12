// What the content editor's side panels get from the server. Each is built by the server
// function or route named on it, which is checked against it. Import-free.

// ── Availability panel (holiday lets): getEditorAvailability() in server/utils/availability.ts

export interface AvailabilityFeed {
  id: string
  url: string
  label: string
  lastSyncedAt: string | null
  lastError: string | null
  eventCount: number
}

/** Nights blocked by hand. `endDate` is the day guests leave. */
export interface AvailabilityOwnBlock {
  id: string
  startDate: string
  endDate: string
  note: string
}

export interface EditorAvailability {
  itemId: string
  feeds: AvailabilityFeed[]
  blocks: AvailabilityOwnBlock[]
  /** The calendar link to paste into Airbnb and Booking.com (own blocks only). */
  exportUrl: string
}

// ── Client picks panel: listPicksForItem() in server/utils/gallery-picks.ts

export interface PickerSummary {
  id: string
  blockId: string
  name: string
  note: string | null
  submittedAt: string | null
  updatedAt: string
  /** With each photo's original file name, for finding it in Lightroom. */
  photos: { url: string; fileName: string }[]
}

// ── Revision history: GET /api/v1/content/:id/revisions

export interface RevisionSummary {
  id: string
  title: string
  summary: string | null
  createdAt: string
  authorId: string | null
}

// ── AI tools

/** POST /api/v1/ai/grammar: one suggested fix. */
export interface GrammarCorrection {
  original: string
  corrected: string
  reason: string
}

export interface GrammarResult {
  corrections: GrammarCorrection[]
}

export interface ReadabilityIssue {
  type: string
  excerpt: string
  suggestion: string
}

/** POST /api/v1/ai/readability. English gets a real Flesch score; other languages an AI estimate. */
export interface ReadabilityResult {
  score: number
  gradeLevel: string
  issues: ReadabilityIssue[]
  summary: string
  method?: 'flesch' | 'ai-estimate'
}

/** POST /api/v1/ai/suggest-terms: existing terms that fit, and new ones worth adding. */
export interface TermSuggestions {
  matchedTerms: { id: string; name: string; taxonomyId: string; taxonomySlug: string }[]
  newTermSuggestions: { taxonomySlug: string; name: string }[]
}
