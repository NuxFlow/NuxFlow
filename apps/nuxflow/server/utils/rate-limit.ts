import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import { getClientIp } from './client-ip'

interface RateLimitOptions {
  limit: number
  windowMs: number
  keyPrefix?: string
}

// One atomic statement per request — INSERT ... ON CONFLICT DO UPDATE ... RETURNING against
// D1 — so concurrent requests for the same key can't both read a pre-increment count (a
// read-then-write could, and KV is eventually consistent, so neither holds a limit across
// isolates).
//
// The isolate-local map below is only a fast-fail cache of keys D1 has already confirmed
// over the limit, so a sustained burst on one isolate is refused without a D1 round trip.
// It can never under-count: every request not already known to be blocked goes to D1.
// Keys contain the caller's IP, so the map is bounded; expired entries are dropped as it fills.
const BLOCKED_MAX_ENTRIES = 1000
const blockedUntil = new Map<string, number>()

function rememberBlocked(key: string, resetMs: number, now: number) {
  if (blockedUntil.size >= BLOCKED_MAX_ENTRIES) {
    for (const [k, until] of blockedUntil) if (until <= now) blockedUntil.delete(k)
    // Still full: drop the oldest (a Map iterates in insertion order).
    for (const k of blockedUntil.keys()) {
      if (blockedUntil.size < BLOCKED_MAX_ENTRIES) break
      blockedUntil.delete(k)
    }
  }
  blockedUntil.set(key, resetMs)
}

export async function rateLimit(event: H3Event, opts: RateLimitOptions): Promise<void> {
  const ip = getClientIp(event) ?? 'unknown'
  const siteId = event.context.siteId ?? 'global'
  const key = `${opts.keyPrefix ?? 'rl'}:${siteId}:${ip}`
  const now = Date.now()

  const blockedAt = blockedUntil.get(key)
  if (blockedAt !== undefined) {
    if (blockedAt > now) {
      throw createError({
        statusCode: 429,
        message: 'Too many requests',
        data: { retryAfter: Math.ceil((blockedAt - now) / 1000) },
      })
    }
    blockedUntil.delete(key)
  }

  const db = useDb(event)
  const candidateResetAt = new Date(now + opts.windowMs).toISOString()

  // `datetime(...)` normalises both sides before comparing — reset_at is stored as a JS
  // `toISOString()` value ("...T...Z"), which does not lexically compare correctly
  // against SQLite's own `datetime('now')` output ("... ...", space-separated, no "Z")
  // without normalisation.
  const result = await db.get<{ count: number; reset_at: string }>(sql`
    INSERT INTO rate_limits (key, count, reset_at) VALUES (${key}, 1, ${candidateResetAt})
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN datetime(reset_at) <= datetime('now') THEN 1 ELSE count + 1 END,
      reset_at = CASE WHEN datetime(reset_at) <= datetime('now') THEN ${candidateResetAt} ELSE reset_at END
    RETURNING count, reset_at
  `)

  const count = result?.count ?? 1
  const windowResetAt = result?.reset_at ?? candidateResetAt

  if (count > opts.limit) {
    const resetMs = new Date(windowResetAt).getTime()
    rememberBlocked(key, resetMs, now)
    const retryAfter = Math.ceil((resetMs - now) / 1000)
    throw createError({ statusCode: 429, message: 'Too many requests', data: { retryAfter } })
  }
}

