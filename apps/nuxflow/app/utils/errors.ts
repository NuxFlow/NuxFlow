/**
 * Extracts a user-facing message from a caught `$fetch`/`useFetch` error — Nuxt/ofetch
 * errors carry the server's response body under `.data` (an H3 error payload, `{ message }`
 * for every route in this app's convention), which isn't part of the standard `Error` shape
 * TypeScript knows about after a `catch (e: unknown)`. Falls back to the error's own
 * `.message` (e.g. a network failure with no response body at all) and finally to
 * `fallback` when neither is present.
 */
export function getErrorMessage(e: unknown, fallback: string): string {
  const err = e as { data?: { message?: string }; message?: string } | null | undefined
  return err?.data?.message ?? err?.message ?? fallback
}

/**
 * Better Auth's client resolves to `{ data, error }` instead of throwing. Throws that
 * `error` so a `useAdminAction().run()` callback reports it like a failed `$fetch`.
 */
/**
 * True when Better Auth refused because the sign-in is more than a day old
 * (`SESSION_NOT_FRESH` — adding a passkey, unlinking a sign-in method). The fix is to sign
 * in again (`useAccounts().reauthUrl()`), not to show the raw "Session is not fresh".
 */
export function isSessionNotFresh(res: { error?: object | null } | null | undefined): boolean {
  // `code` is on every Better Auth error at runtime, but not in every endpoint's client type.
  return (res?.error as { code?: unknown } | null | undefined)?.code === 'SESSION_NOT_FRESH'
}

export function throwIfAuthError(res: { error?: { message?: string } | null } | null | undefined): void {
  if (res?.error) throw new Error(res.error.message || 'Request failed')
}
