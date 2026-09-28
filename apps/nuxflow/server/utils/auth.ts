import type { H3Event } from 'h3'
import { getSiteSession } from './site-auth'
import { accountsUrl, isTenantHostInCentralMode } from './accounts-origin'

// The single source of truth for server-side session validation.
//
// On a site's own domain under central sign-in (see accounts-origin.ts) the session is a
// *site session* (site-auth.ts) — valid for that one site only. Everywhere else (the
// accounts origin, or a single-site install signing in on its own domain) it's the Better
// Auth session from the same instance (better-auth.ts, getOrCreateBetterAuth) that
// handles /api/auth/**. Both return the same { user, session } shape.
export async function requireSession(event: H3Event) {
  const session = await getAuthSession(event)
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return session
}

// Non-throwing counterpart for routes where auth is optional (public pages that
// vary for logged-in visitors, guest-or-member comments, etc.) — returns null instead of
// throwing when there's no valid session.
// Named getAuthSession (not getSession) to avoid shadowing h3's own built-in
// getSession — Nitro would silently prefer this one over h3's, which is correct
// today but exactly the kind of implicit auto-import collision this project has
// already been bitten by once.
export async function getAuthSession(event: H3Event) {
  if (isTenantHostInCentralMode(event)) return getSiteSession(event)
  const auth = await getOrCreateBetterAuth(event)
  return auth.api.getSession({ headers: event.headers })
}

/**
 * For account-wide actions — deleting the account, exporting its data, notification
 * preferences, anything that isn't about one site. Under central sign-in these only
 * accept a session on the accounts origin: a site-session cookie from some site's own
 * domain (where that site's admin can run their own scripts) must never be able to act on
 * the account itself.
 */
export async function requireAccountSession(event: H3Event) {
  if (isTenantHostInCentralMode(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Account settings are managed on the accounts site',
      data: { accountsUrl: accountsUrl('/account') },
    })
  }
  return requireSession(event)
}
