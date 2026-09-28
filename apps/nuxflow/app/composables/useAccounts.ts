/**
 * Where sign-in happens — the client-side mirror of server/utils/accounts-origin.ts.
 *
 * - `central`: NUXT_PUBLIC_ACCOUNTS_URL is set. Passwords, passkeys and account settings
 *   live only on that origin; a site's own domain signs in through a handoff
 *   (/_nuxflow/auth/start) and gets a login valid for that site only.
 * - `isAccountsHost`: this page is on the accounts origin.
 * - `onSiteDomain`: central mode, on a site's own domain — never render a password field
 *   or Better Auth call here; send people to the accounts origin instead.
 */
export function useAccounts() {
  const raw = String(useRuntimeConfig().public.accountsUrl ?? '').trim()
  let accountsOrigin: string | null = null
  try {
    accountsOrigin = raw ? new URL(raw).origin : null
  } catch { /* invalid — treated as same-origin, like the server */ }

  const central = accountsOrigin !== null
  const requestHost = useRequestURL().host
  const isAccountsHost = central && requestHost === new URL(accountsOrigin!).host
  const onSiteDomain = central && !isAccountsHost

  /** Where to send someone who needs to sign in, then come back to `returnTo`. */
  function signInUrl(returnTo = '/admin'): string {
    if (onSiteDomain) return `/_nuxflow/auth/start?${new URLSearchParams({ return_to: returnTo })}`
    // The accounts origin's login page continues to `next` (see pages/login.vue).
    if (isAccountsHost) return `/login?${new URLSearchParams({ next: returnTo })}`
    return `/login?${new URLSearchParams({ redirect: returnTo })}`
  }

  /** A link to an accounts-origin page (or the same-origin page on a single-site install). */
  function accountsLink(path: string): string {
    return central ? `${accountsOrigin}${path}` : path
  }

  return { central, accountsOrigin, isAccountsHost, onSiteDomain, signInUrl, accountsLink }
}

/** Accept only same-origin relative paths as a post-sign-in destination. */
export function safeNextPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
