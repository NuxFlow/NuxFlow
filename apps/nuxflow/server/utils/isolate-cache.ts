// Generic per-isolate TTL cache. Keyed by an arbitrary string (usually siteId).
// Shared by theme-cache.ts and appearance-cache.ts, which each stay in their own
// plain module (rather than inside their respective Nitro plugins) so mutation
// routes can import a clear*Cache() function without pulling in a
// defineNitroPlugin() call, which only exists inside the Nitro runtime.
export interface IsolateCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  /** Evicts a single key. */
  delete(key: string): void
  /** Evicts every key — mirrors Map's own no-arg `clear()`. */
  clear(): void
}

export function createIsolateCache<T>(ttlMs: number): IsolateCache<T> {
  const store = new Map<string, { value: T; expires: number }>()

  return {
    get(key) {
      const cached = store.get(key)
      if (cached && cached.expires > Date.now()) return cached.value
      return undefined
    },
    set(key, value) {
      store.set(key, { value, expires: Date.now() + ttlMs })
    },
    delete(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}
