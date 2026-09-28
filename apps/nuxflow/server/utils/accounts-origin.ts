import type { H3Event } from 'h3'

/**
 * Where people sign in.
 *
 * **Central mode** (`NUXT_PUBLIC_ACCOUNTS_URL` set — required once a deployment hosts more
 * than one site): every password, passkey, OAuth callback and account-wide action happens
 * on that dedicated origin, which never renders any site's content or custom code. A
 * site's own domain has no Better Auth endpoints at all; it receives a *site session* —
 * valid for that one site only — through a one-time-code handoff (server/utils/site-auth.ts).
 *
 * Why: accounts are global (one login works on every site), and a site admin can add their
 * own scripts to their site's pages (Settings → Appearance → custom code). If sign-in
 * happened on the site's own domain, that script could read the password as it's typed,
 * the reset token from the reset link, or register its own passkey on the visitor's
 * account — taking over an account that may also run other sites, or the platform. The
 * same design as Shopify (accounts.shopify.com) or Google (accounts.google.com).
 *
 * **Same-origin mode** (unset): a single-site install signs in on its own domain, as the
 * operator's own site is the only code there. Creating a second site is refused until the
 * accounts origin is configured (admin/sites/index.post.ts).
 */
export function getAccountsOrigin(): string | null {
  const raw = String(useRuntimeConfig().public.accountsUrl ?? '').trim()
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    console.error('[accounts] NUXT_PUBLIC_ACCOUNTS_URL is not a valid URL — falling back to same-origin sign-in:', raw)
    return null
  }
}

export function isCentralAuth(): boolean {
  return getAccountsOrigin() !== null
}

/** The Host this accounts origin is served on — `accounts.example.com` (plus port locally). */
export function getAccountsHost(): string | null {
  const origin = getAccountsOrigin()
  return origin ? new URL(origin).host : null
}

/** True when this request arrived on the accounts origin (central mode only). */
export function isAccountsHost(event: H3Event): boolean {
  const accountsHost = getAccountsHost()
  if (!accountsHost) return false
  const host = (getHeader(event, 'host') ?? '').toLowerCase()
  if (host === accountsHost) return true
  // Some local requests arrive without the port; production hosts never carry one.
  return !accountsHost.includes(':') ? false : host === accountsHost.split(':')[0]
}

/**
 * True for a request on a site's own domain while central sign-in is on — where
 * account-wide actions and Better Auth endpoints must never be reachable.
 */
export function isTenantHostInCentralMode(event: H3Event): boolean {
  return isCentralAuth() && !isAccountsHost(event)
}

/** Absolute URL on the accounts origin (central mode), or a same-origin path otherwise. */
export function accountsUrl(path: string): string {
  const origin = getAccountsOrigin()
  return origin ? `${origin}${path}` : path
}
