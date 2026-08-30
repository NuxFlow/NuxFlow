/** True if `err` is an H3/Nitro error created via `createError` (has a `statusCode`). */
export function isHttpError(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'statusCode' in err
}

/** Extracts a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback = 'Unexpected error'): string {
  return err instanceof Error ? err.message : fallback
}
