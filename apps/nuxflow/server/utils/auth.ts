import type { H3Event } from 'h3'

// The single source of truth for server-side session validation — backed by
// the same Better Auth instance (server/utils/better-auth.ts, getOrCreateBetterAuth)
// that actually handles /api/auth/** (see server/api/auth/[...all].ts and
// server/middleware/04.auth-override.ts). A session issued at sign-in always
// validates here because it's the exact same instance, not a second one.
//
// Do NOT reach for @onmax/nuxt-better-auth's own requireUserSession/getUserSession
// — those resolve a *separate* Better Auth instance (server/auth.config.ts) that
// independently derives its own baseURL/cookie config from the request. The two
// configs drifting out of sync (they did, once already) makes sessions that are
// valid on /api/auth/** silently 401 everywhere else.
export async function requireSession(event: H3Event) {
  const auth = await getOrCreateBetterAuth(event)
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return session
}
