// Comment shapes the server sends and the app reads. Import-free.

export type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash'

/**
 * A comment as a page's discussion shows it (GET /api/v1/content/:id/comments). Never an
 * email address. Visitors get approved comments only; editors also see the rest.
 */
export interface PublicComment {
  id: string
  body: string
  createdAt: string
  parentId: string | null
  status: CommentStatus
  /** A guest's own name, or null for a signed-in commenter. */
  guestName: string | null
  /** A signed-in commenter's account name, or null for a guest. */
  authorName: string | null
}

/** A comment in Admin → Comments (GET /api/v1/comments), with the page it's on. */
export interface AdminComment {
  id: string
  body: string
  status: CommentStatus
  createdAt: string
  guestName: string | null
  guestEmail: string | null
  authorName: string | null
  authorEmail: string | null
  itemId: string
  itemTitle: string | null
  itemSlug: string | null
}
