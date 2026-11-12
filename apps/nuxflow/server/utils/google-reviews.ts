import type { H3Event } from 'h3'
import { resolveStringSetting } from './settings'
import { getBusinessInfo } from './business'

/**
 * Google reviews for the Google Reviews block: the business's rating, review count and the
 * most relevant reviews Google returns (at most five), from the Places API (New) Place
 * Details, using the site's own API key (Settings → Business → Google reviews) and its Place
 * ID. Each call is billed to that key's Google Cloud project, so the public route caches the
 * answer for an hour at the edge. Google's terms require showing its attribution and the
 * reviews as written, which the block does.
 */

export const GOOGLE_PLACES_KEY_SETTING = 'integrations.google_places_key'
const PLACES_URL = 'https://places.googleapis.com/v1/places/'
const FIELDS = 'displayName,rating,userRatingCount,googleMapsUri,reviews'

export interface GoogleReview {
  author: string
  authorUrl: string | null
  photo: string | null
  rating: number
  text: string
  /** "2 weeks ago", in Google's words. */
  when: string
}

export interface GoogleReviews {
  name: string
  rating: number | null
  count: number
  /** The business on Google Maps, where all its reviews are. */
  url: string | null
  reviews: GoogleReview[]
}

function asString(v: unknown, max = 5000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function httpsOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\//.test(v) ? v.slice(0, 2000) : null
}

/** Google's answer, reduced to what the block shows. */
export function parsePlaceDetails(json: unknown): GoogleReviews {
  const p = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const reviews = (Array.isArray(p.reviews) ? p.reviews : []).slice(0, 5).map((r: Record<string, unknown>) => {
    const author = (r.authorAttribution ?? {}) as Record<string, unknown>
    const text = (r.text ?? r.originalText ?? {}) as Record<string, unknown>
    return {
      author: asString(author.displayName, 200) || 'A Google user',
      authorUrl: httpsOrNull(author.uri),
      photo: httpsOrNull(author.photoUri),
      rating: typeof r.rating === 'number' ? Math.max(1, Math.min(5, Math.round(r.rating))) : 5,
      text: asString(text.text),
      when: asString(r.relativePublishTimeDescription, 100),
    }
  })
  return {
    name: asString((p.displayName as Record<string, unknown> | undefined)?.text, 200),
    rating: typeof p.rating === 'number' ? Math.round(p.rating * 10) / 10 : null,
    count: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
    url: httpsOrNull(p.googleMapsUri),
    reviews,
  }
}

/** The business's Google reviews, or null when they aren't set up or Google says no. */
export async function fetchGoogleReviews(event: H3Event): Promise<GoogleReviews | null> {
  const [key, info] = await Promise.all([resolveStringSetting(event, GOOGLE_PLACES_KEY_SETTING), getBusinessInfo(event)])
  const placeId = info?.googlePlaceId
  if (!key || !placeId) return null
  try {
    const res = await fetch(`${PLACES_URL}${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error(`[google-reviews] Places API answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
      return null
    }
    return parsePlaceDetails(await res.json())
  }
  catch (err) {
    console.error('[google-reviews] Places API failed:', err)
    return null
  }
}
