/** True if `err` is an H3/Nitro error created via `createError` (has a `statusCode`). */
export function isHttpError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'statusCode' in err
}

/** Extracts a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback = 'Unexpected error'): string {
  return err instanceof Error ? err.message : fallback
}

/**
 * Extracts a human-readable, credential/rate-limit-aware message from a media provider
 * upload/delete failure — mirrors ai-sdk.ts's `aiErrorMessage()`, which already does this
 * for AI provider errors, so the two kinds of "third-party API call failed" errors surface
 * with the same quality of message instead of one being classified and the other opaque.
 * Unlike AI SDK errors (which expose a structured `.status` property), the real remote
 * media providers (Cloudflare Images, S3, Bunny.net — R2 uses the R2Bucket binding directly,
 * never HTTP, so it never reaches this path) each throw a plain Error with the HTTP status
 * embedded in the message text (e.g. "Bunny.net upload failed: 401",
 * "S3 upload failed: 403 <body>"), so the status is parsed back out of that text instead.
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
