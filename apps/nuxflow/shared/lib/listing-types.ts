// Public listings: the blog and Posts block (GET /api/public/posts), a term's archive
// (GET /api/public/taxonomy/:taxonomy/:term) and a taxonomy's overview
// (GET /api/public/taxonomy/:taxonomy). Import-free.

/** One item in a public listing (listPublicItems() in server/utils/taxonomy.ts). */
export interface PublicPostCard {
  id: string
  title: string
  slug: string
  /** The item's public address: translations at /{locale}/{source slug}, the homepage at /. */
  path: string
  excerpt: string | null
  ogImage: string | null
  publishedAt: string | null
  typeSlug: string | null
  /** A few of the type's custom fields, formatted, when the listing is of one type. */
  details?: { key: string; label: string; text: string }[]
}

export type FilterableType = 'number' | 'boolean' | 'select' | 'multiselect'

/** A filter a listing of one type offers (the Posts block's "Show filters"). */
export interface PublicFilterDef {
  key: string
  label: string
  type: FilterableType
  options?: string[]
  prefix?: string
  suffix?: string
}

interface Paged {
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface PostsResponse extends Paged {
  posts: PublicPostCard[]
  filters?: PublicFilterDef[]
}

/** A term's archive page. A hierarchical term's also lists its sub-terms' content. */
export interface TermArchive extends Paged {
  taxonomy: { id: string; name: string; slug: string; isHierarchical: boolean; noindex: boolean }
  term: {
    id: string
    name: string
    slug: string
    description: string | null
    seoTitle: string | null
    seoDescription: string | null
    ogImage: string | null
  }
  ancestors: { slug: string; name: string }[]
  children: { slug: string; name: string }[]
  items: PublicPostCard[]
}

/** A term on a taxonomy's overview page, with how much is filed under it. */
export interface TermCount {
  slug: string
  name: string
  description: string | null
  parentSlug: string | null
  /** Items tagged with this term itself. */
  count: number
  /** Items under it, its sub-terms' included. */
  total: number
}

export interface TaxonomyOverview {
  taxonomy: { slug: string; name: string; description: string | null; isHierarchical: boolean; noindex: boolean }
  terms: TermCount[]
}
