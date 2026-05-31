import type { H3Event } from 'h3'
import { rateLimits } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

interface RateLimitOptions {
  limit: number
  windowMs: number
  keyPrefix?: string
}

// Memory cache stable within a Cloudflare Workers isolate
const _memoryCache = new Map<string, { count: number; resetAt: number }>()
let _cleanupInterval: ReturnType<typeof setInterval> | null = null

function ensureCleanup() {
  if (_cleanupInterval) return
  _cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, val] of _memoryCache.entries()) {
      if (val.resetAt <= now) {
        _memoryCache.delete(key)
      }
    }
  }, 60000)
  
  if (typeof _cleanupInterval?.unref === 'function') {
    _cleanupInterval.unref()
  }
}

export async function rateLimit(event: H3Event, opts: RateLimitOptions): Promise<void> {
  ensureCleanup()
  const ip = getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? 'unknown'
  const key = `${opts.keyPrefix ?? 'rl'}:${ip}`
  const now = Date.now()

  // 1. Isolate-level memory check: Block rapid attempts instantly without D1 calls
  const cached = _memoryCache.get(key)
  if (cached && cached.resetAt > now) {
    if (cached.count > opts.limit) {
      const retryAfter = Math.ceil((cached.resetAt - now) / 1000)
      throw createError({ statusCode: 429, message: 'Too many requests', data: { retryAfter } })
    }
    cached.count++
  } else {
    _memoryCache.set(key, { count: 1, resetAt: now + opts.windowMs })
  }

  // 2. Database fallback: Fetch global rate limits for multi-isolate consistency
  const db = useDb(event)
  const existing = await db.query.rateLimits.findFirst({ where: eq(rateLimits.key, key) })

  let count: number
  let windowResetAt: string

  if (!existing || new Date(existing.resetAt).getTime() <= now) {
    const resetAt = new Date(now + opts.windowMs).toISOString()
    if (existing) {
      await db.update(rateLimits).set({ count: 1, resetAt }).where(eq(rateLimits.key, key))
    } else {
      await db.insert(rateLimits).values({ key, count: 1, resetAt })
    }
    count = 1
    windowResetAt = resetAt
  } else {
    count = (existing.count ?? 0) + 1
    windowResetAt = existing.resetAt
    await db.update(rateLimits).set({ count }).where(eq(rateLimits.key, key))
  }

  // Sync memory cache with DB count
  const currentMemory = _memoryCache.get(key)
  if (currentMemory) {
    currentMemory.count = Math.max(currentMemory.count, count)
    currentMemory.resetAt = new Date(windowResetAt).getTime()
  }

  if (count > opts.limit) {
    const retryAfter = Math.ceil((new Date(windowResetAt).getTime() - now) / 1000)
    throw createError({ statusCode: 429, message: 'Too many requests', data: { retryAfter } })
  }
}

