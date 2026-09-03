import type { H3Event } from 'h3'
import { useDb, type Db } from '../../../utils/db'
import { trackPageView } from '../../../utils/analytics'
import { contentItems, contentTypes, membershipTiers, redirects, subscriptions, users } from '@nuxflow/db/schema'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { withEdgeCache } from '../../../utils/edge-cache'

type ContentItemRow = typeof contentItems.$inferSelect

async function checkContentAccess(event: H3Event, page: { visibility: string; settings: Record<string, unknown> | null | undefined }, siteId: string) {
  const visibility = page.visibility ?? 'public'
  if (visibility === 'public') return null

  // private pages are never accessible via public API
  if (visibility === 'private') return { blocked: true, reason: 'private' as const, requiredTier: null, tiers: [] }

  // members-only: check active subscription
  if (visibility === 'members' || visibility === 'password') {
    const access = (page.settings as { access?: string } | null)?.access ?? (visibility === 'members' || visibility === 'password' ? 'members' : 'public')
    if (access === 'public') return null

    const session = await getAuthSession(event).catch(() => null)
    const apiKeyUserId = event.context.apiKeyUserId as string | undefined
    const userId = (session?.user?.id as string | undefined) ?? apiKeyUserId

    if (!userId) {
      const tiers = await fetchTiers(siteId)
      return { blocked: true, reason: 'members' as const, requiredTier: null, tiers }
    }

    const db = useDb(event)
    const requiredTierId = access.startsWith('tier:') ? access.slice(5) : null

    // `status` alone is only as fresh as the last webhook delivery — a failed card during
    // dunning, or a delayed/dropped webhook, would otherwise leave `status: 'active'`
    // (and therefore full access) indefinitely. currentPeriodEnd is already stored on
    // every subscription row (webhook-sync.ts, checkout.post.ts's free-tier path included)
    // and needs no extra network call, so require it to still be in the future too —
    // access fails closed when the webhook stream stalls, rather than staying open until
    // one eventually arrives. `isNull` covers legacy/free rows with no period recorded.
    const activeSub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.siteId, siteId),
        eq(subscriptions.status, 'active'),
        or(isNull(subscriptions.currentPeriodEnd), sql`datetime(${subscriptions.currentPeriodEnd}) > datetime('now')`),
      ),
    })

    if (!activeSub) {
      const tiers = await fetchTiers(siteId)
      return { blocked: true, reason: 'members' as const, requiredTier: requiredTierId, tiers }
    }

    if (requiredTierId && activeSub.tierId !== requiredTierId) {
      const tiers = await fetchTiers(siteId)
      return { blocked: true, reason: 'tier' as const, requiredTier: requiredTierId, tiers }
    }
  }

  return null
}

async function fetchTiers(siteId: string) {
  const db = useDb()
  const rows = await db.query.membershipTiers.findMany({
    where: eq(membershipTiers.siteId, siteId),
    orderBy: (t, { asc }) => [asc(t.price)],
    columns: { id: true, name: true, price: true, currency: true, interval: true, features: true },
  })
  return rows
}

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const slug = getRouterParam(event, 'slug')!

  // Check redirects first
  const redirect = await db.query.redirects.findFirst({
    where: and(eq(redirects.siteId, siteId), eq(redirects.from, `/${slug}`)),
  })
  if (redirect) {
    return sendRedirect(event, redirect.to, redirect.statusCode)
  }

  // Multilingual URL parsing:
  // Detect if slug starts with a locale prefix (e.g. "es/my-page" or is exactly "es")
  const SUPPORTED_LOCALES = new Set([
    'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ja', 'zh-CN', 'zh-TW', 'ko', 'ar', 'ru', 'hi'
  ])

  let requestedLocale: string | null = null
  let actualSlug = slug

  const parts = slug.split('/')
  const potentialLocale = parts[0]

  let hasLocaleMatch = false
  if (potentialLocale && potentialLocale.length >= 2 && potentialLocale.length <= 10) {
    if (SUPPORTED_LOCALES.has(potentialLocale)) {
      hasLocaleMatch = true
    } else {
      // Dynamic fallback: query database for active locales
      const activeLocales = await db.select({ locale: contentItems.locale })
        .from(contentItems)
        .where(eq(contentItems.siteId, siteId))
        .groupBy(contentItems.locale)
      const activeSet = new Set(activeLocales.map(l => l.locale).filter(Boolean))
      if (activeSet.has(potentialLocale)) {
        hasLocaleMatch = true
      }
    }
  }

  if (hasLocaleMatch) {
    requestedLocale = potentialLocale!
    actualSlug = parts.slice(1).join('/') || 'home'
  }

  // 1. Try finding by exact slug first
  let page = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.slug, actualSlug),
      eq(contentItems.status, 'published'),
    ),
  })

  // 2. Resolve translations:
  if (!page && requestedLocale) {
    // Look up by original slug, then find its translation
    const sourcePage = await db.query.contentItems.findFirst({
      where: and(
        eq(contentItems.siteId, siteId),
        eq(contentItems.slug, actualSlug),
        eq(contentItems.status, 'published')
      ),
    })
    if (sourcePage) {
      const translation = await db.query.contentItems.findFirst({
        where: and(
          eq(contentItems.siteId, siteId),
          eq(contentItems.sourceItemId, sourcePage.id),
          eq(contentItems.locale, requestedLocale),
          eq(contentItems.status, 'published')
        ),
      })
      page = translation || sourcePage
    }
  } else if (page && requestedLocale && page.locale !== requestedLocale) {
    // Exact slug matches but locale differs — search for a linked translation
    const sourceId = page.sourceItemId || page.id
    const translation = await db.query.contentItems.findFirst({
      where: and(
        eq(contentItems.siteId, siteId),
        eq(contentItems.sourceItemId, sourceId),
        eq(contentItems.locale, requestedLocale),
        eq(contentItems.status, 'published')
      ),
    })
    if (translation) {
      page = translation
    }
  }

  if (!page) throw notFound('Not found')

  const gate = await checkContentAccess(event, { visibility: page.visibility, settings: page.settings as Record<string, unknown> | null }, siteId)
  if (gate?.blocked) {
    throw createError({
      statusCode: 402,
      data: { gated: true, requiredTier: gate.requiredTier, tiers: gate.tiers },
    })
  }

  trackPageView(event, { siteId, slug })

  // Member/password-gated pages that passed the gate are per-caller (the response
  // depends on the requester's session/subscription, not just the URL), so they must
  // never be shared via the edge cache — gating is always evaluated fresh above, on
  // every request, before the cache is ever consulted. Only genuinely public pages are
  // eligible for the edge cache below.
  const isGated = page.visibility === 'members' || page.visibility === 'password'
  if (isGated) {
    setHeader(event, 'Cache-Control', 'private, no-store')
    return assemblePageResponse(db, page, siteId)
  }

  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  return withEdgeCache(event, 3600, () => assemblePageResponse(db, page, siteId))
})

async function assemblePageResponse(db: Db, page: ContentItemRow, siteId: string) {
  // Content type, author, and source-page lookups are all independent of each
  // other (they only need `page`, already resolved above), so run them as one
  // round trip each in parallel instead of three sequential ones.
  const [type, authorUser, sourcePageResolved] = await Promise.all([
    page.typeId
      ? db.query.contentTypes.findFirst({
          where: eq(contentTypes.id, page.typeId),
          columns: { hasComments: true },
        })
      : Promise.resolve(null),
    page.authorId
      ? db.query.users.findFirst({
          where: eq(users.id, page.authorId),
          columns: { name: true, image: true },
        })
      : Promise.resolve(null),
    page.sourceItemId
      ? db.query.contentItems.findFirst({
          where: eq(contentItems.id, page.sourceItemId),
          columns: { locale: true, slug: true },
        })
      : Promise.resolve(null),
  ])

  // Per-item override takes precedence; null means "inherit from content type"
  const hasComments = page.allowComments !== null && page.allowComments !== undefined
    ? page.allowComments
    : (type?.hasComments ?? false)

  const author: { name: string; image: string | null } | null = authorUser ?? null

  // Resolve available translations for the switcher
  const availableLocales: Array<{ locale: string; slug: string; rawSlug: string }> = []
  const sourceId = page.sourceItemId || page.id
  const sourcePage = page.sourceItemId
    ? sourcePageResolved
    : page

  if (sourcePage) {
    availableLocales.push({
      locale: sourcePage.locale || 'en',
      slug: sourcePage.slug,
      rawSlug: sourcePage.slug
    })

    const siblings = await db.query.contentItems.findMany({
      where: and(
        eq(contentItems.siteId, siteId),
        eq(contentItems.sourceItemId, sourceId),
        eq(contentItems.status, 'published')
      ),
      columns: { locale: true, slug: true },
    })

    siblings.forEach(s => {
      availableLocales.push({
        locale: s.locale,
        slug: sourcePage.slug, // clean prefix routing uses parent slug
        rawSlug: s.slug
      })
    })
  }

  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    locale: page.locale || 'en',
    content: page.content,
    excerpt: page.excerpt,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImage: page.ogImage,
    canonicalUrl: page.canonicalUrl,
    metaRobots: page.metaRobots,
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt,
    hasComments,
    author,
    availableLocales,
  }
}
