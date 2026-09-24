import type { H3Event } from 'h3'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * True when a state-changing /api request carrying cookies was issued by a page on a
 * different origin — i.e. a cross-site request forgery attempt.
 *
 * SameSite=Lax session cookies already stop this between unrelated domains, but not
 * between "same-site" sibling subdomains (`tenant-a.example.com` → `tenant-b.example.com`),
 * which is a common multi-tenant layout here — and every site admin can run arbitrary
 * script on their own public pages by design. h3's readBody() also parses
 * application/x-www-form-urlencoded, so a plain auto-submitting HTML form (no CORS
 * preflight) could otherwise drive JSON-shaped endpoints like POST /api/v1/users.
 *
 * Only requests that carry a Cookie header are checked: without one there's no ambient
 * credential to forge (API-key requests, payment webhooks, and the opaque-origin plugin
 * iframe's credential-less calls all fall through). A missing Origin header is allowed —
 * browsers always send one on cross-origin unsafe requests, so its absence means a
 * non-browser client, which can't be the victim of CSRF.
 */
export function isCrossOriginUnsafeRequest(event: H3Event): boolean {
  if (!UNSAFE_METHODS.has(event.method)) return false
  if (!getHeader(event, 'cookie')) return false

  const fetchSite = getHeader(event, 'sec-fetch-site')
  if (fetchSite) return fetchSite !== 'same-origin' && fetchSite !== 'none'

  const origin = getHeader(event, 'origin')
  if (!origin) return false
  if (origin === 'null') return true
  try {
    return new URL(origin).host !== getHeader(event, 'host')
  } catch {
    return true
  }
}
