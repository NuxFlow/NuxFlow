// A published page as GET /api/public/pages/:slug sends it — built by assemblePageResponse()
// (server/api/public/pages/[...slug].get.ts), read by PublicContentPage and the homepage.
// Import-free apart from other shared/lib types.
import type { FieldDetail } from './custom-fields'
import type { EpisodeInfo } from './podcast'
import type { PublicProduct } from './product-types'

/** A video on the page, for VideoObject structured data (server/utils/video-seo.ts). */
export interface PageVideo {
  name: string
  description: string
  thumbnailUrl: string
  embedUrl: string
  /** The video's own page on its platform. */
  watchUrl: string
  /** ISO 8601 with time zone. */
  uploadDate: string
  /** ISO 8601 duration, e.g. PT3M20S. */
  duration?: string
  durationSeconds?: number
}

/** An event's details on its page (EventDetails.vue). A series shows its next date. */
export interface PublicEventInfo {
  startAt: string
  endAt?: string | null
  allDay?: boolean | null
  location?: string | null
  url?: string | null
  timeZone?: string
  rsvp?: boolean
  icsUrl?: string | null
  /** A repeating event's rule, in words. */
  repeats?: string | null
  price?: number | null
  currency?: string | null
}

export interface PageAuthor {
  name: string
  image: string | null
}

/** A taxonomy term the page is filed under, with its archive's address. */
export interface PublicTerm {
  taxonomySlug: string
  taxonomyName: string
  isHierarchical: boolean
  termSlug: string
  termName: string
  path: string
}

export interface PublicPage {
  id: string
  title: string
  slug: string
  /** The page's one public address (publicPathForItem()). */
  path?: string
  seoTitle?: string | null
  seoDescription?: string | null
  content: unknown
  excerpt?: string | null
  ogImage?: string | null
  canonicalUrl?: string | null
  metaRobots?: string | null
  /** The effective robots directive; null = index,follow. */
  robots?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
  hasComments?: boolean | null
  author?: PageAuthor | null
  locale?: string | null
  defaultLocale?: string | null
  type?: { slug: string; name: string } | null
  event?: PublicEventInfo | null
  product?: PublicProduct | null
  /** A podcast episode's audio (Settings → Podcast), played by the site-wide player. */
  episode?: EpisodeInfo | null
  /** The type's custom fields, formatted (Admin → Content types). */
  details?: FieldDetail[]
  availableLocales?: Array<{ locale: string; slug: string; rawSlug?: string }> | null
  alternates?: Array<{ locale: string; path: string }> | null
  terms?: PublicTerm[] | null
  videos?: PageVideo[] | null
}
