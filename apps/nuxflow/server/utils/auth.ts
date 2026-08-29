import type { H3Event } from 'h3'

// The single source of truth for server-side session validation — backed by
// the same Better Auth instance (server/utils/better-auth.ts, getOrCreateBetterAuth)
// that actually handles /api/auth/** (see server/api/auth/[...all].ts and
// server/middleware/04.auth-override.ts). A session issued at sign-in always
// validates here because it's the exact same instance — there is only one.
export async function requireSession(event: H3Event) {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return session
}

// Non-throwing counterpart for routes where auth is optional (public pages that
// vary for logged-in visitors, guest-or-member comments, etc.) — same shared
// instance, returns null instead of throwing when there's no valid session.
// Named getAuthSession (not getSession) to avoid shadowing h3's own built-in
// getSession — Nitro would silently prefer this one over h3's, which is correct
// today but exactly the kind of implicit auto-import collision this project has
// already been bitten by once.
export async function getAuthSession(event: H3Event) {
  const auth = await getOrCreateBetterAuth(event)
  return auth.api.getSession({ headers: event.headers })
}
