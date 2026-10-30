import { httpError } from './response'

/**
 * True if `err` is an HTTP error h3 itself made — ours via `httpError()`, or the runtime's
 * own. The same test as h3 v1's `isError()` (which h3 v2 drops), plus h3 v2's `HTTPError`,
 * so it works before and after the Nitro v3 upgrade. Unlike {@link isHttpError} it never
 * matches a provider SDK error that merely carries a `statusCode`.
 */
export function isH3Error(err: unknown): err is Error & { message: string } {
  if (!(err instanceof Error)) return false
  return (err.constructor as { __h3_error__?: unknown }).__h3_error__ === true || err.name === 'HTTPError'
}

/** The HTTP status an error carries: `statusCode` in h3 v1, `status` in h3 v2. */
export function httpErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown }
  if (typeof statusCode === 'number') return statusCode
  return typeof status === 'number' ? status : undefined
}

/** True if `err` is an H3/Nitro error created via `createError` (has a `statusCode`). */
export function isHttpError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'statusCode' in err
}

/** Extracts a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback = 'Unexpected error'): string {
  return err instanceof Error ? err.message : fallback
}

/**
 * Rethrows a caught payment-provider call failure as a clean 502 (or passes through an
 * H3 error unchanged, e.g. one of this codebase's own `notFound()`/`conflict()` calls
 * made from inside the same try block). `label` names the operation that failed
 * (checkout / billing portal request / cancellation).
 */
export function rethrowAsProviderError(err: unknown, operationLabel: string): never {
  if (isHttpError(err)) throw err
  throw httpError({ status: 502, message: `Payment provider ${operationLabel} failed: ${errorMessage(err)}` })
}

/**
 * Extracts a human-readable, credential/rate-limit-aware message from a media provider
 * upload/delete failure — mirrors ai-sdk.ts's `aiErrorMessage()`, which already does this
 * for AI provider errors, so the two kinds of "third-party API call failed" errors surface
 * with the same quality of message instead of one being classified and the other opaque.
 * Unlike AI SDK errors (which expose a structured `.status` property), the real remote
 * media provider (Cloudflare Images — R2 uses the R2Bucket binding directly, never HTTP,
 * so it never reaches this path) throws a plain Error with the HTTP status embedded in the
 * message text (e.g. "Cloudflare Images upload failed: 403 <body>"), so the status is
 * parsed back out of that text instead.
 */
export function mediaErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Media provider request failed'
  const match = err.message.match(/failed:\s*(\d{3})/)
  const status = match ? Number(match[1]) : undefined
  if (status === 401 || status === 403) return 'Media provider authentication failed — check your credentials in Settings → Media'
  if (status === 429) return 'Media provider rate limit exceeded — try again in a moment'
  if (status === 404) return 'Media provider resource not found — check your bucket/zone configuration in Settings → Media'
  return err.message
}
