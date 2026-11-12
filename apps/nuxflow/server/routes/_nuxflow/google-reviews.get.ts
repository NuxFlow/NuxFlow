import { withEdgeCache } from '../../utils/edge-cache'
import { fetchGoogleReviews } from '../../utils/google-reviews'

// The Google Reviews block's data (server/utils/google-reviews.ts). Each Google call is billed
// to the site's own API key, so the answer is kept at the edge for an hour. Not under /api:
// another typed API route address trips TS2589.
const CACHE_SECONDS = 3600

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`)
  return withEdgeCache(event, CACHE_SECONDS, async () => ({ reviews: await fetchGoogleReviews(event) }))
})
