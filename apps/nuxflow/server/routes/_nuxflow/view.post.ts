import { z } from 'zod'
import { recordPageView } from '../../utils/analytics'
import { createIsolateCache } from '../../utils/isolate-cache'

const bodySchema = z.object({
  path: z.string().max(2048),
  referrer: z.string().max(2048).optional(),
})

// A rough per-visitor brake, kept in this isolate only (a D1 rate limit would cost one
// database write per page view). It stops a single client inflating a site's numbers —
// and the account's Analytics Engine bill — from one connection; it isn't a hard limit.
const MAX_VIEWS_PER_MINUTE = 60
const recentViews = createIsolateCache<number>(60_000)

/**
 * One page view from the site's own pages (app/plugins/page-views.client.ts) — see
 * server/utils/analytics.ts. Always answers 204 with no body: the browser doesn't wait
 * for it, and a refused view isn't worth telling anyone about.
 */
export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId
  if (!siteId || event.context.isAccountsHost) return noContent(event)

  // Only the site's own pages. A beacon from another site arrives as `cross-site`, which
  // would otherwise let anyone pad a site's numbers from a page of their own.
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') return noContent(event)

  const ip = getRequestHeader(event, 'cf-connecting-ip') ?? 'unknown'
  const key = `${siteId}:${ip}`
  const seen = recentViews.get(key) ?? 0
  if (seen >= MAX_VIEWS_PER_MINUTE) return noContent(event)
  recentViews.set(key, seen + 1)

  const parsed = bodySchema.safeParse(await readBody(event).catch(() => null))
  if (parsed.success) recordPageView(event, siteId, parsed.data)
  return noContent(event)
})
