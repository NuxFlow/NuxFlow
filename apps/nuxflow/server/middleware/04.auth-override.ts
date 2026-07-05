import { toWebRequest } from 'h3'
import { rateLimit } from '../utils/rate-limit'

// Rate limits for the specific auth sub-paths that are meaningful brute-force /
// abuse targets. Deliberately narrow — session checks (get-session) and OAuth
// callbacks fire on every page load and aren't throttled here. Better Auth's
// own built-in rateLimit is disabled (see better-auth.ts) because its default
// storage is in-memory per Worker isolate, which doesn't hold up across
// Cloudflare's isolate churn; this reuses the same D1-backed rateLimit() utility
// already used elsewhere in the app for consistent, cross-isolate limits.
const AUTH_RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  '/api/auth/sign-in/email': { limit: 10, windowMs: 10 * 60_000 },
  '/api/auth/sign-up/email': { limit: 5, windowMs: 60 * 60_000 },
  '/api/auth/forget-password': { limit: 3, windowMs: 15 * 60_000 },
  '/api/auth/reset-password': { limit: 10, windowMs: 15 * 60_000 },
}

// Intercepts all /api/auth/** requests BEFORE route handlers run.
// This guarantees our Better Auth instance (with allowedHosts for multi-domain
// OAuth) handles auth regardless of module-route registration order in Nitro.
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/auth')) return

  const limitOpts = AUTH_RATE_LIMITS[event.path]
  if (limitOpts) {
    await rateLimit(event, { ...limitOpts, keyPrefix: `auth:${event.path}` })
  }

  const auth = await getOrCreateBetterAuth(event)
  return auth.handler(toWebRequest(event))
})
