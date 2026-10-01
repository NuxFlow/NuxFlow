import type { H3Event } from 'h3'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { membershipTiers, subscriptions } from '@nuxflow/db/schema'
import { useDb } from './db'

/**
 * The public access gate for one content item's `visibility` (+ `settings.access` for
 * members-only items): null when the caller may see it, otherwise why not and which tiers
 * would unlock it. Used by the public page API (which answers a block with 402 and the
 * paywall) and by anything else that exposes an item's content or discussion publicly,
 * such as its comments — so a members-only page's comments are gated exactly like the page.
 */
export async function checkContentAccess(event: H3Event, page: { visibility: string; settings: Record<string, unknown> | null | undefined }, siteId: string) {
  const visibility = page.visibility ?? 'public'
  if (visibility === 'public') return null

  // private pages are never accessible via public API
  if (visibility === 'private') return { blocked: true, reason: 'private' as const, requiredTier: null, tiers: [] }

  // members-only: check active subscription
  if (visibility === 'members') {
    const access = (page.settings as { access?: string } | null)?.access ?? 'members'
    if (access === 'public') return null

    const session = await getAuthSession(event).catch(() => null)
    const apiKeyUserId = event.context.apiKeyUserId as string | undefined
    const userId = (session?.user?.id as string | undefined) ?? apiKeyUserId

    if (!userId) {
      const tiers = await fetchTiers(event, siteId)
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
    // 'trialing' must grant access too — otherwise a user actively paying for (or in) a
    // trial period is denied the exact content the trial exists to let them evaluate.
    const activeSub = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.siteId, siteId),
        inArray(subscriptions.status, ['active', 'trialing']),
        or(isNull(subscriptions.currentPeriodEnd), sql`datetime(${subscriptions.currentPeriodEnd}) > datetime('now')`),
      ),
    })

    if (!activeSub) {
      const tiers = await fetchTiers(event, siteId)
      return { blocked: true, reason: 'members' as const, requiredTier: requiredTierId, tiers }
    }

    if (requiredTierId && activeSub.tierId !== requiredTierId) {
      const tiers = await fetchTiers(event, siteId)
      return { blocked: true, reason: 'tier' as const, requiredTier: requiredTierId, tiers }
    }
  }

  return null
}

async function fetchTiers(event: H3Event, siteId: string) {
  const db = useDb(event)
  const rows = await db.query.membershipTiers.findMany({
    where: eq(membershipTiers.siteId, siteId),
    orderBy: (t, { asc }) => [asc(t.price)],
    columns: { id: true, name: true, price: true, currency: true, interval: true, features: true },
  })
  return rows
}
