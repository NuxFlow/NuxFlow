import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIsolateCache } from '../../server/utils/isolate-cache'

afterEach(() => {
  vi.useRealTimers()
})

describe('createIsolateCache', () => {
  it('returns a value until its TTL passes, then forgets it', () => {
    vi.useFakeTimers()
    const cache = createIsolateCache<string>(1_000)
    cache.set('a', 'one')
    expect(cache.get('a')).toBe('one')
    vi.advanceTimersByTime(1_001)
    expect(cache.get('a')).toBeUndefined()
  })

  it('keeps null as a real cached value', () => {
    const cache = createIsolateCache<string | null>(1_000)
    cache.set('missing', null)
    expect(cache.get('missing')).toBeNull()
  })

  it('never grows past maxEntries — a stream of new keys evicts the oldest', () => {
    const cache = createIsolateCache<number>(60_000, 3)
    for (let i = 0; i < 10; i++) cache.set(`host-${i}.example.com`, i)
    expect(cache.get('host-6.example.com')).toBeUndefined()
    expect(cache.get('host-7.example.com')).toBe(7)
    expect(cache.get('host-9.example.com')).toBe(9)
  })

  it('sweeps expired entries before evicting live ones', () => {
    vi.useFakeTimers()
    const cache = createIsolateCache<number>(1_000, 2)
    cache.set('old', 1)
    vi.advanceTimersByTime(1_001)
    cache.set('live-a', 2)
    cache.set('live-b', 3)
    expect(cache.get('live-a')).toBe(2)
    expect(cache.get('live-b')).toBe(3)
  })

  it('re-setting a key makes it the newest, so it survives eviction', () => {
    const cache = createIsolateCache<number>(60_000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10)
    cache.set('c', 3)
    expect(cache.get('a')).toBe(10)
    expect(cache.get('b')).toBeUndefined()
  })
})
