// What GET /api/v1/content sends (server/api/v1/content/index.get.ts): one page of a content
// type's items, for Admin → Content and the menu editor's page picker. Import-free.

export type ContentStatus = 'draft' | 'review' | 'published' | 'scheduled' | 'archived'

export interface ContentListItem {
  id: string
  title: string
  slug: string
  status: ContentStatus
  publishedAt: string | null
  updatedAt: string
  authorId: string | null
  /** Bumped on every save (the editor's optimistic lock). */
  version: number
  locale: string
  /** Set on a translation: the item it was translated from. */
  sourceItemId: string | null
  eventStartAt: string | null
  eventEndAt: string | null
  eventAllDay: boolean | null
}

export interface ContentListResponse {
  items: ContentListItem[]
  /** The content type listed (its whole row; only these are relied on). */
  type: { id: string; slug: string; name: string }
  page: number
  limit: number
  /** Left out for a delta sync (`updatedAfter`), which returns every changed item at once. */
  total?: number
}
