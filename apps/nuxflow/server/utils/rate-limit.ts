import type { H3Event } from 'h3'
import { rateLimits } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

interface RateLimitOptions {
  limit: number
  windowMs: number
  keyPrefix?: string
}

export async function rateLimit(event: H3Event, opts: RateLimitOptions): Promise<void> {
  const ip = getHeader(event, 'cf-connecting-ip') ?? getHeader(event, 'x-forwarded-for') ?? 'unknown'
  const key = `${opts.keyPrefix ?? 'rl'}:${ip}`
  const now = Date.now()
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

  if (count > opts.limit) {
    const retryAfter = Math.ceil((new Date(windowResetAt).getTime() - now) / 1000)
    throw createError({ statusCode: 429, message: 'Too many requests', data: { retryAfter } })
  }
}
