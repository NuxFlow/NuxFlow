import type { H3Event } from 'h3'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

interface ContentSettings {
  access?: string // 'public' | 'members' | 'tier:<tierId>'
}

export interface GateResult {
  blocked: true
  requiredTier: string | null // tierId or null for any-membership
}

/**
 * Checks whether the request is allowed to view content with the given settings.
 * Returns null if access is granted, or a GateResult if the viewer must subscribe.
 */
export async function resolveContentGate(
  event: H3Event,
  settings: ContentSettings | null | undefined,
): Promise<GateResult | null> {
  const access = settings?.access ?? 'public'
  if (access === 'public') return null

  const session = await getUserSession(event).catch(() => null)
  const apiKeyUserId = event.context.apiKeyUserId as string | undefined
  const userId = (session?.user?.id as string | undefined) ?? apiKeyUserId

  if (!userId) {
    return {
      blocked: true,
      requiredTier: access === 'members' ? null : access.replace('tier:', ''),
    }
  }

  const siteId = event.context.siteId as string
  const db = useDb()

  const activeSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.siteId, siteId),
      eq(subscriptions.status, 'active'),
    ),
  })

  if (access === 'members') {
    return activeSub ? null : { blocked: true, requiredTier: null }
  }

  if (access.startsWith('tier:')) {
    const tierId = access.slice(5)
    if (activeSub?.tierId === tierId) return null
    return { blocked: true, requiredTier: tierId }
  }

  return null
}
