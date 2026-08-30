/** Wraps a provider API call made during tier create/update so failures get a
 * consistent 400 + log shape instead of each call site repeating its own
 * try/catch. `providerLabel` is used both in the log prefix and the thrown message. */
export async function syncPaymentProvider<T>(providerLabel: string, action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[${providerLabel.toLowerCase()}] Auto-sync failed on ${action}:`, err)
    throw createError({
      statusCode: 400,
      message: `${providerLabel} synchronization failed: ${(err as Error).message}`,
    })
  }
}
