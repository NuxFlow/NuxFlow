import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  bumpCacheVersionInKv,
  FALLBACK_CACHE_VERSION,
  readCacheVersion,
  resetCacheVersionState,
  versionedCacheUrl,
} from '../../server/utils/cache-version'

function fakeKv() {
  const store = new Map<string, string>()
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
  }
}
type Kv = Parameters<typeof readCacheVersion>[0]

beforeEach(() => {
  resetCacheVersionState()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('readCacheVersion', () => {
  it('is the fallback without a KV binding, or before any bump', async () => {
    expect(await readCacheVersion(null, 'site-1')).toBe(FALLBACK_CACHE_VERSION)
    expect(await readCacheVersion(fakeKv() as unknown as Kv, 'site-1')).toBe(FALLBACK_CACHE_VERSION)
  })

  it('reads with a KV edge-cache TTL and remembers the value briefly per isolate', async () => {
    const kv = fakeKv()
    kv.store.set('cache-version:site-1', 'abc')
    expect(await readCacheVersion(kv as unknown as Kv, 'site-1')).toBe('abc')
    expect(await readCacheVersion(kv as unknown as Kv, 'site-1')).toBe('abc')
    expect(kv.get).toHaveBeenCalledTimes(1)
    expect(kv.get).toHaveBeenCalledWith('cache-version:site-1', { cacheTtl: 30 })
  })

  it('never throws when KV fails — a page must not break over this', async () => {
    const kv = { get: vi.fn().mockRejectedValue(new Error('kv down')) }
    expect(await readCacheVersion(kv as unknown as Kv, 'site-1')).toBe(FALLBACK_CACHE_VERSION)
  })
})

describe('bumpCacheVersionInKv', () => {
  it('writes a new value per site that later reads see', async () => {
    vi.useFakeTimers()
    const kv = fakeKv()
    expect(await bumpCacheVersionInKv(kv as unknown as Kv, 'site-1')).toBe(true)
    const first = await readCacheVersion(kv as unknown as Kv, 'site-1')
    expect(first).not.toBe(FALLBACK_CACHE_VERSION)
    expect(await readCacheVersion(kv as unknown as Kv, 'site-2')).toBe(FALLBACK_CACHE_VERSION)

    const second = bumpCacheVersionInKv(kv as unknown as Kv, 'site-1')
    await vi.advanceTimersByTimeAsync(1_200)
    expect(await second).toBe(true)
    expect(await readCacheVersion(kv as unknown as Kv, 'site-1')).not.toBe(first)
  })

  // KV accepts one write per second to a key; a burst of edits must not fail.
  it('spaces writes to the same key at least a second apart', async () => {
    vi.useFakeTimers()
    const kv = fakeKv()
    await bumpCacheVersionInKv(kv as unknown as Kv, 'site-1')
    const second = bumpCacheVersionInKv(kv as unknown as Kv, 'site-1')
    await vi.advanceTimersByTimeAsync(500)
    expect(kv.put).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(700)
    expect(await second).toBe(true)
    expect(kv.put).toHaveBeenCalledTimes(2)
  })

  it('retries once after a failed write, then reports failure', async () => {
    vi.useFakeTimers()
    const kv = { put: vi.fn().mockRejectedValue(new Error('429')) }
    const result = bumpCacheVersionInKv(kv as unknown as Kv, 'site-1')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await result).toBe(false)
    expect(kv.put).toHaveBeenCalledTimes(2)
  })

  it('reports false without a KV binding, so callers fall back to deleting entries', async () => {
    expect(await bumpCacheVersionInKv(null, 'site-1')).toBe(false)
  })
})

describe('versionedCacheUrl', () => {
  it('adds the version as a query parameter', () => {
    expect(versionedCacheUrl('https://a.test/x', 'v1')).toBe('https://a.test/x?__nfc=v1')
    expect(versionedCacheUrl('https://a.test/x?page=2', 'v1')).toBe('https://a.test/x?page=2&__nfc=v1')
  })
})
