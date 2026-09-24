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
  '/api/auth/request-password-reset': { limit: 3, windowMs: 15 * 60_000 },
  '/api/auth/reset-password': { limit: 10, windowMs: 15 * 60_000 },
  // WebAuthn itself isn't brute-forceable (the challenge is single-use and the private key
  // never leaves the authenticator), so these two aren't a brute-force target the way the
  // paths above are. They're throttled anyway because challenge generation still does real
  // work (a DB round trip to look up the user's registered credentials for
  // generate-authenticate-options, and a session lookup for generate-register-options) —
  // unthrottled, an attacker could use them for isolate/D1 load amplification. The limit is
  // generous (per-minute, not per-hour) since a legitimate passkey flow can retry a few
  // times in quick succession (cancelled browser prompt, switching authenticators, etc.).
  '/api/auth/passkey/generate-register-options': { limit: 30, windowMs: 60_000 },
  '/api/auth/passkey/generate-authenticate-options': { limit: 30, windowMs: 60_000 },
}

// Intercepts all /api/auth/** requests BEFORE route handlers run.
// This guarantees our Better Auth instance (with allowedHosts for multi-domain
// OAuth) handles auth regardless of module-route registration order in Nitro.
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/auth')) return

  // Match on the pathname only — event.path includes the query string, so keying the
  // lookup on it let `/api/auth/sign-in/email?x=1` miss every limit below while Better
  // Auth's own router (which ignores the query string) still handled it normally.
  // Trailing slashes are trimmed for the same reason.
  const pathname = getRequestURL(event).pathname.replace(/\/+$/, '')

  // Better Auth's own sign-up endpoint is global and ignores the per-site
  // `auth.allow_public_registration` setting. Nothing in the app calls it: public
  // registration goes through api/public/auth/register.post.ts (which enforces that
  // setting), and invites/restores create accounts in-process via auth.api.signUpEmail()
  // (user-provisioning.ts), which never passes through this middleware. Leaving it open
  // let anyone pre-register an email address before its real owner was invited — the
  // invite would then attach its role to the attacker-controlled account.
  if (pathname === '/api/auth/sign-up/email') {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const limitOpts = AUTH_RATE_LIMITS[pathname]
  if (limitOpts) {
    await rateLimit(event, { ...limitOpts, keyPrefix: `auth:${pathname}` })
  }

  const auth = await getOrCreateBetterAuth(event)
  return auth.handler(toWebRequest(event))
})
