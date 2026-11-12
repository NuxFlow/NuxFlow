import { inject, type Component, type InjectionKey } from 'vue'
import type { CanvasContent } from './types'
import type { AiInstruction } from './editor/useAiImprove'

/** A post as the Posts block lists it (GET /api/public/posts in NuxFlow). */
export interface CanvasPostItem {
  id: string
  title: string
  path: string
  excerpt: string | null
  ogImage: string | null
  publishedAt: string | null
  /** The type's custom fields, formatted ("Price", "£250,000"), when the listing has a type. */
  details?: Array<{ key: string; label: string; text: string }>
}

/** The business's Google reviews, for the Google Reviews block. */
export interface CanvasGoogleReviews {
  name: string
  rating: number | null
  count: number
  url: string | null
  reviews: Array<{ author: string; authorUrl: string | null; photo: string | null; rating: number; text: string; when: string }>
}

/** A holiday let's booked nights: `start` is the first night, `end` the day the guests leave. */
export interface CanvasAvailability {
  /** Today's date (YYYY-MM-DD), so the calendar greys out the past. */
  today: string
  booked: Array<{ start: string; end: string }>
}

/** A client's favourites in a Gallery block with "Let clients pick favourites". */
export interface CanvasGalleryPicks {
  pickerName: string
  photos: string[]
  note: string | null
  submittedAt: string | null
}

export interface CanvasGalleryPicksSave {
  path: string
  block: string
  /** A random token the browser keeps, so each person edits only their own picks. */
  token: string
  name: string
  photos: string[]
  note?: string
  /** "Send my picks" — tells the site's team. */
  submit?: boolean
}

/** A custom field a listing can be filtered by (Admin → Content types → "Use as a filter"). */
export interface CanvasPostFilter {
  key: string
  label: string
  type: 'number' | 'boolean' | 'select' | 'multiselect'
  options?: string[]
  prefix?: string
  suffix?: string
}

/** An event as the Calendar block shows it (GET /api/public/events in NuxFlow). */
export interface CanvasEventItem {
  id: string
  slug?: string
  title: string
  /** The event's own page. */
  path?: string
  excerpt?: string | null
  eventStartAt: string
  eventEndAt?: string | null
  eventAllDay?: boolean | null
  eventLocation?: string | null
  eventUrl?: string | null
  /** Its "Add to calendar" file. */
  icsUrl?: string
  /** Visitors can RSVP on its page. */
  rsvp?: boolean
  /** Which date of a repeating event this is. */
  date?: string | null
  /** Per place, when it's paid. */
  price?: number | null
  currency?: string | null
  /** Its terms in the taxonomy asked for. */
  terms?: Array<{ slug: string; name: string }>
}

export interface CanvasClassPass {
  id: string
  name: string
  description?: string | null
  credits: number
  price: number
  currency: string
  validDays?: number | null
}

export interface CanvasEventsQuery {
  limit: number
  /** Overlapping this window, as ISO 8601. Without one: what's coming up, or `past`. */
  from?: string
  to?: string
  past?: boolean
  /** Adds each event's terms in this taxonomy. */
  taxonomy?: string
}

export interface CanvasEventList {
  events: CanvasEventItem[]
  /** The site's time zone, which every time is shown in. */
  timeZone: string
  /** The site's calendar subscription address. */
  feedUrl?: string
}

/** A product as the Products and Product blocks show it (GET /api/public/shop in NuxFlow). */
export interface CanvasProductCard {
  id: string
  title: string
  path: string
  excerpt: string | null
  image: string | null
  /** Ready to show, in the shop's currency: "£12.00" or "From £12.00". */
  price: string
  /** The "was" price, struck through. */
  compareAt: string | null
  available: boolean
  /** Its one variant, when it has exactly one, so it can go straight in the basket. */
  variantId?: string | null
  variantLabel?: string | null
}

export interface CanvasProductsQuery {
  limit: number
  /** A collection's slug; its sub-collections' products are included. */
  collection?: string
  /** Particular products, by slug, in this order. */
  slugs?: string[]
}

export interface CanvasPostsQuery {
  limit: number
  type?: string
  taxonomy?: string
  term?: string
  /** Custom-field filters as `f.<key>` / `f.<key>.min|max` query values. */
  filters?: Record<string, string>
  /** `f.<key>` (low first) or `-f.<key>` (high first), a number field. */
  sort?: string
}

export interface CanvasPageRequest {
  description: string
  tone: string
  pageGoal: string
}

/**
 * Everything this package needs from the app it runs in: data for the blocks that list
 * site content, the editor's AI actions, and two app components. The app provides one
 * instance at its root (`provide(canvasHostKey, …)`, NuxFlow's app/plugins/canvas-host.ts),
 * so no block or editor component knows an API path. Methods throw an `Error` whose
 * message is fit to show the user.
 */
export interface CanvasHost {
  listPosts(query: CanvasPostsQuery): Promise<CanvasPostItem[]>
  /** The custom-field filters a listing of this content type offers; [] for none. */
  listPostFilters?(type: string): Promise<CanvasPostFilter[]>
  /** The site's Google reviews (Settings → Business), or null when they aren't set up. */
  googleReviews?(): Promise<CanvasGoogleReviews | null>
  /** A holiday let's booked nights, for the published page at `path` (Availability calendar block). */
  availability?(path: string): Promise<CanvasAvailability>
  /** Client proofing: a visitor's own saved picks in a gallery, or null. */
  loadGalleryPicks?(query: { path: string; block: string; token: string }): Promise<CanvasGalleryPicks | null>
  /** Client proofing: saves (or, with `submit`, sends) a visitor's picks. */
  saveGalleryPicks?(input: CanvasGalleryPicksSave): Promise<{ count: number; submitted: boolean }>
  listEvents(query: CanvasEventsQuery): Promise<CanvasEventList>
  /** The class passes on sale, and where to go to buy one. */
  listClassPasses?(): Promise<{ passes: CanvasClassPass[]; canBuy: boolean }>
  /** Products on sale; an empty list where the site has no shop. */
  listProducts?(query: CanvasProductsQuery): Promise<CanvasProductCard[]>
  /** Puts a one-variant product in the visitor's basket. */
  addToBasket?(product: CanvasProductCard): void
  /** Alternative wordings of `text` for the inline AI menu. */
  improveText(text: string, instruction: AiInstruction): Promise<string[]>
  /** A whole Canvas page from a description (the editor's "Generate with AI"). */
  generatePage(request: CanvasPageRequest): Promise<CanvasContent>
  /** Focal point of a media-library image, as percentages (0–100) from the top left. */
  suggestFocalPoint(url: string): Promise<{ focalX: number; focalY: number }>
  /**
   * The player URL for a Cloudflare Stream video that may be private (playable only with
   * a signed link): a signed player URL, or null when the video is public and its plain
   * URL works. `blockId`/`path` name the Video block on the public page being viewed
   * (empty inside the editor, where the signed-in team member is the authorization).
   */
  videoPlaybackUrl?(request: { streamId: string; blockId: string; path: string }): Promise<string | null>
  /** Media library picker dialog — emits `select(PickedMedia)` / `selectMany(PickedMedia[])`. */
  mediaPicker?: Component
  /** Dictation button — emits `transcribed(text)`. */
  voiceInput?: Component
}

export const canvasHostKey: InjectionKey<CanvasHost> = Symbol('nuxflow:canvas-host')

export function useCanvasHost(): CanvasHost {
  const host = inject(canvasHostKey, null)
  if (!host) throw new Error('@nuxflow/canvas: no CanvasHost provided — the app must provide(canvasHostKey, …) at its root')
  return host
}
