import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import { getClientIp } from '../../server/utils/client-ip'
import { withTimeout } from '../../server/utils/timeout'
import { utcDay, utcDayAgo } from '../../server/utils/utc-day'
import { createCounterBuffer } from '../../server/utils/counter-buffer'
import { toFtsQuery, rawRows } from '../../server/utils/search'

function eventWithHeaders(headers: Record<string, string>): H3Event {
  return { headers } as unknown as H3Event
}

describe('getClientIp', () => {
  beforeEach(() => {
    vi.stubGlobal('getHeader', (event: { headers: Record<string, string> }, name: string) => event.headers[name.toLowerCase()])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('prefers Cloudflare\'s cf-connecting-ip over x-forwarded-for', () => {
    expect(getClientIp(eventWithHeaders({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.1.1.1')
  })

  it('falls back to the first x-forwarded-for address', () => {
    expect(getClientIp(eventWithHeaders({ 'x-forwarded-for': ' 2.2.2.2 , 10.0.0.1' }))).toBe('2.2.2.2')
  })

  it('is null with neither header', () => {
    expect(getClientIp(eventWithHeaders({}))).toBeNull()
  })
})

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers())

  it('resolves with the promise\'s value when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'slow')).resolves.toBe(42)
  })

  it('rejects with the given message when the promise is too slow', async () => {
    vi.useFakeTimers()
    const pending = withTimeout(new Promise(() => {}), 1000, 'the pool didn\'t answer')
    vi.advanceTimersByTime(1000)
    await expect(pending).rejects.toThrow('the pool didn\'t answer')
  })

  it('passes the promise\'s own rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'slow')).rejects.toThrow('boom')
  })
})

describe('utcDay', () => {
  it('formats the UTC calendar day, not the local one', () => {
    expect(utcDay(new Date('2026-10-23T23:30:00-05:00'))).toBe('2026-10-24')
  })

  it('counts whole days back', () => {
    expect(utcDayAgo(1, new Date('2026-03-01T00:10:00Z'))).toBe('2026-02-28')
    expect(utcDayAgo(0, new Date('2026-03-01T00:10:00Z'))).toBe('2026-03-01')
  })
})

describe('createCounterBuffer', () => {
  afterEach(() => vi.useRealTimers())

  const bump = (buffer: ReturnType<typeof createCounterBuffer<{ n: number }>>, key: string) =>
    buffer.add(key, () => ({ n: 0 }), (e) => { e.n++ })

  it('asks for the first count in a fresh isolate to be written at once', () => {
    expect(bump(createCounterBuffer({ flushIntervalMs: 60_000, maxPending: 10 }), 'a')).toBe(true)
  })

  it('adds up counts under one key until the interval has passed', () => {
    vi.useFakeTimers()
    const buffer = createCounterBuffer<{ n: number }>({ flushIntervalMs: 60_000, maxPending: 10 })
    buffer.take()
    expect(bump(buffer, 'a')).toBe(false)
    expect(bump(buffer, 'a')).toBe(false)
    expect(buffer.pending()).toEqual([{ n: 2 }])
    vi.advanceTimersByTime(60_000)
    expect(bump(buffer, 'a')).toBe(true)
    expect(buffer.take()).toEqual([{ n: 3 }])
    expect(buffer.pending()).toEqual([])
  })

  it('asks for a write early once enough distinct counters are waiting', () => {
    const buffer = createCounterBuffer<{ n: number }>({ flushIntervalMs: 60_000, maxPending: 2 })
    buffer.take()
    expect(bump(buffer, 'a')).toBe(false)
    expect(bump(buffer, 'b')).toBe(true)
  })

  it('reset() behaves like a fresh isolate', () => {
    const buffer = createCounterBuffer<{ n: number }>({ flushIntervalMs: 60_000, maxPending: 10 })
    buffer.take()
    bump(buffer, 'a')
    buffer.reset()
    expect(buffer.pending()).toEqual([])
    expect(bump(buffer, 'a')).toBe(true)
  })
})

describe('toFtsQuery', () => {
  it('quotes each word as a prefix term', () => {
    expect(toFtsQuery('greenhouse tomatoes')).toBe('"greenhouse"* "tomatoes"*')
  })

  it('keeps letters in any script', () => {
    expect(toFtsQuery('μουσακάς 日本語')).toBe('"μουσακάς"* "日本語"*')
  })

  it('makes FTS5 syntax inert, and returns null when nothing searchable is left', () => {
    expect(toFtsQuery('cats OR NEAR(')).toBe('"cats"* "OR"* "NEAR"*')
    expect(toFtsQuery('*** "')).toBeNull()
  })
})

describe('rawRows', () => {
  it('reads D1\'s { results } and libSQL\'s { rows }', () => {
    expect(rawRows({ results: [{ a: 1 }] })).toEqual([{ a: 1 }])
    expect(rawRows({ rows: [{ b: 2 }] })).toEqual([{ b: 2 }])
    expect(rawRows({})).toEqual([])
  })
})
