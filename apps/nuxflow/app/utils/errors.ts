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
