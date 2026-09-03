import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'

interface RateLimitOptions {
  limit: number
  windowMs: number
  keyPrefix?: string
}

// Previously this had a two-tier design: an isolate-local in-memory counter, then either
// a KV or D1 read-then-increment-then-write. Both increment steps were a plain read
// followed by a separate write with no compare-and-swap — under real concurrent traffic
// (the exact "isolate churn" scenario this utility exists to survive; see
// 04.auth-override.ts, which disables Better Auth's own in-memory limiter specifically
// because it doesn't hold up across isolates) N simultaneous requests for the same key
// could all read the same pre-increment count before any write landed, letting the
// effective limit be exceeded by roughly the number of in-flight concurrent requests,
// every window. KV additionally can't fix this even in principle — it's eventually
// consistent by design, not a coordination primitive.
//
// This version replaces both increment paths with a single atomic SQL statement: an
// `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` against D1. D1 routes all writes for a
// database through one primary and executes each statement as one atomic unit against
// SQLite's own row-level serialisation — two concurrent requests for the same key cannot
// observe an interleaved pre-increment value the way two separate read-then-write round
// trips could, because there is only one round trip and no read step to race against.
//
// The isolate-local Map below is now purely a fast-fail cache: it is only ever populated
// with a key already confirmed over-limit by D1, so it can reject a sustained burst
// hitting the same isolate without a D1 round trip on every single request, but it can
// never cause an under-count — every request that isn't already known-blocked always goes
// through the atomic D1 statement.
const _blockedUntil = new Map<string, number>()
let _cleanupInterval: ReturnType<typeof setInterval> | null = null

function ensureCleanup() {
  if (_cleanupInterval) return
  _cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, resetAt] of _blockedUntil.entries()) {
      if (resetAt <= now) _blockedUntil.delete(key)
    }
  }, 60000)

  if (typeof _cleanupInterval?.unref === 'function') {
    _cleanupInterval.unref()
  }
}

export async function rateLimit(event: H3Event, opts: RateLimitOptions): Promise<void> {
  ensureCleanup()
  const ip = getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? 'unknown'
  const siteId = (event.context.siteId as string | undefined) ?? 'global'
  const key = `${opts.keyPrefix ?? 'rl'}:${siteId}:${ip}`
  const now = Date.now()

  const blockedAt = _blockedUntil.get(key)
  if (blockedAt && blockedAt > now) {
    throw createError({
      statusCode: 429,
      message: 'Too many requests',
      data: { retryAfter: Math.ceil((blockedAt - now) / 1000) },
    })
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
    _blockedUntil.set(key, resetMs)
    const retryAfter = Math.ceil((resetMs - now) / 1000)
    throw createError({ statusCode: 429, message: 'Too many requests', data: { retryAfter } })
  }
}

