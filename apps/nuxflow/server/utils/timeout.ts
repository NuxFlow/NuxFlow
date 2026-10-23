/**
 * Rejects with `Error(message)` when `promise` hasn't settled within `ms`. The timer is
 * always cleared, so a promise that settles in time leaves nothing pending in the isolate.
 * The original promise isn't cancelled — pass an AbortSignal to it where it takes one.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
