/**
 * Counts added up in this isolate and written to D1 in batches, for counters bumped on
 * busy paths (usage.ts, crawler-tracking.ts) where a write per request would load the
 * database's single primary. It's time to write when `flushIntervalMs` has passed since the
 * last write — so the first count in a fresh isolate is written straight away — or when
 * `maxPending` distinct counters are waiting. Counts still waiting when an isolate shuts
 * down are lost (never doubled), which these approximate counters accept.
 */
export interface CounterBuffer<T> {
  /**
   * Updates the entry under `key` (making it with `create()` first). Returns true when the
   * caller should now take() the batch and write it.
   */
  add(key: string, create: () => T, update: (entry: T) => void): boolean
  /** Empties the buffer and returns what was in it. */
  take(): T[]
  /** What's waiting to be written, without taking it. */
  pending(): T[]
  /** Forgets everything, as a fresh isolate would (tests). */
  reset(): void
}

export function createCounterBuffer<T>(opts: { flushIntervalMs: number; maxPending: number }): CounterBuffer<T> {
  const entries = new Map<string, T>()
  let lastFlushAt = 0

  return {
    add(key, create, update) {
      let entry = entries.get(key)
      if (!entry) {
        entry = create()
        entries.set(key, entry)
      }
      update(entry)
      return Date.now() - lastFlushAt >= opts.flushIntervalMs || entries.size >= opts.maxPending
    },
    take() {
      const batch = [...entries.values()]
      entries.clear()
      lastFlushAt = Date.now()
      return batch
    },
    pending: () => [...entries.values()],
    reset() {
      entries.clear()
      lastFlushAt = 0
    },
  }
}
