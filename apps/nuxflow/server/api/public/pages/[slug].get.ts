import type { H3Event } from 'h3'
import { useDb } from '../../../utils/db'
import { trackPageView } from '../../../utils/analytics'
import { contentItems, contentTypes, membershipTiers, redirects, subscriptions, users } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

async function checkContentAccess(event: H3Event, page: { visibility: string; settings: Record<string, unknown> | null | undefined }, siteId: string) {
  const visibility = page.visibility ?? 'public'
  if (visibility === 'public') return null

  // private pages are never accessible via public API
  if (visibility === 'private') return { blocked: true, reason: 'private' as const, requiredTier: null, tiers: [] }

  // members-only: check active subscription
  if (visibility === 'members' || visibility === 'password') {
    const access = (page.settings as { access?: string } | null)?.access ?? (visibility === 'members' || visibility === 'password' ? 'members' : 'public')
    if (access === 'public') return null

    const session = await getUserSession(event).catch(() => null)
    const apiKeyUserId = event.context.apiKeyUserId as string | undefined
    const userId = (session?.user?.id as string | undefined) ?? apiKeyUserId

    if (!userId) {
      const tiers = await fetchTiers(siteId)
      return { blocked: true, reason: 'members' as const, requiredTier: null, tiers }
    }

    const db = useDb(event)
    const requiredTierId = access.startsWith('tier:') ? access.slice(5) : null

    const activeSub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.siteId, siteId),
        eq(subscriptions.status, 'active'),
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

  const page = await db.query.contentItems.findFirst({
    where: and(
      eq(contentItems.siteId, siteId),
      eq(contentItems.slug, slug),
      eq(contentItems.status, 'published'),
    ),
  })

  if (!page) throw createError({ statusCode: 404, message: 'Not found' })

  const gate = await checkContentAccess(event, { visibility: page.visibility, settings: page.settings as Record<string, unknown> | null }, siteId)
  if (gate?.blocked) {
    throw createError({
      statusCode: 402,
      data: { gated: true, requiredTier: gate.requiredTier, tiers: gate.tiers },
    })
  }

  const type = page.typeId
    ? await db.query.contentTypes.findFirst({
        where: eq(contentTypes.id, page.typeId),
        columns: { hasComments: true },
      })
    : null

  // Per-item override takes precedence; null means "inherit from content type"
  const hasComments = page.allowComments !== null && page.allowComments !== undefined
    ? page.allowComments
    : (type?.hasComments ?? false)

  // Member/password-gated pages that passed the gate must not be publicly cached
  const isGated = page.visibility === 'members' || page.visibility === 'password'
  if (isGated) {
    setHeader(event, 'Cache-Control', 'private, no-store')
  }
  else {
    setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
  }

  trackPageView(event, { siteId, slug })

  let author: { name: string; image: string | null } | null = null
  if (page.authorId) {
    const authorUser = await db.query.users.findFirst({
      where: eq(users.id, page.authorId),
      columns: { name: true, image: true },
    })
    author = authorUser ?? null
  }

  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
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
  }
})
