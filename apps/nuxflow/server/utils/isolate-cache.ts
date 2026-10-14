// Generic per-isolate TTL cache. Keyed by an arbitrary string (usually siteId).
// Shared by theme-cache.ts and appearance-cache.ts, which each stay in their own
// plain module (rather than inside their respective Nitro plugins) so mutation
// routes can import a clear*Cache() function without pulling in a
// defineNitroPlugin() call, which only exists inside the Nitro runtime.
//
// Bounded: some keys come from the request (the Host header in 02.multi-site.ts and
// better-auth.ts), and with wildcard routes any made-up subdomain reaches this Worker.
// Without a cap, expired entries were never removed, so a stream of random hostnames
// grew the map until the isolate hit its memory limit. Expired entries are dropped when
// read, and once the map passes `maxEntries` every expired entry is swept and, if that
// isn't enough, the oldest are evicted.
export interface IsolateCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  /** Evicts a single key. */
  delete(key: string): void
  /** Evicts every key — mirrors Map's own no-arg `clear()`. */
  clear(): void
}

export const DEFAULT_ISOLATE_CACHE_MAX_ENTRIES = 1000

export function createIsolateCache<T>(ttlMs: number, maxEntries = DEFAULT_ISOLATE_CACHE_MAX_ENTRIES): IsolateCache<T> {
  const store = new Map<string, { value: T; expires: number }>()

  function prune() {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (entry.expires <= now) store.delete(key)
    }
    // A Map iterates in insertion order and set() re-inserts, so the first key is the
    // least recently written.
    for (const key of store.keys()) {
      if (store.size <= maxEntries) break
      store.delete(key)
    }
  }

  return {
    get(key) {
      const cached = store.get(key)
      if (!cached) return undefined
      if (cached.expires > Date.now()) return cached.value
      store.delete(key)
      return undefined
    },
    set(key, value) {
      store.delete(key)
      store.set(key, { value, expires: Date.now() + ttlMs })
      if (store.size > maxEntries) prune()
    },
    delete(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}
