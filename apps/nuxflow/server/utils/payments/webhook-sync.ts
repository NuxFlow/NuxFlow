import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { membershipTiers, subscriptions } from '@nuxflow/db/schema'
import { useDb } from '../db'
import { resolveSetting } from '../settings'
import { sendPushToUser } from '../webpush'
import type { PaymentProviderName, SubscriptionStatus } from './types'

// The column each provider's webhook payload actually resolves a membership tier by.
const TIER_LOOKUP_COLUMN = {
  stripe: membershipTiers.stripePriceId,
  lemonsqueezy: membershipTiers.lsVariantId,
  paddle: membershipTiers.paddleProductId,
} as const

export interface SubscriptionUpsert {
  provider: PaymentProviderName
  userId: string
  providerSubscriptionId: string
  providerCustomerId: string
  status: SubscriptionStatus
  /** priceId / variantId / productId — whichever field this provider's payload carries */
  tierLookupId?: string
  currentPeriodStart?: string
  currentPeriodEnd?: string
  /**
   * Whether this webhook's specific event type represents a fresh activation worth
   * notifying about. Only takes effect when this call turns out to be an insert (no
   * existing row) — each provider decides this from its own event-type vocabulary
   * (e.g. Lemon Squeezy and Paddle only push on their "created"/"activated" event,
   * not on "updated"/"resumed" even though those also land in this same upsert path).
   */
  pushOnActivation: boolean
}

export interface SubscriptionCancellation {
  provider: PaymentProviderName
  providerSubscriptionId: string
  cancelledAt?: string
}

async function maybeSendPaymentPush(event: H3Event, userId: string, tierName: string | undefined) {
  const enabled = await resolveSetting(event, 'push.events.payment_confirmation')
  if (enabled !== 'true') return
  sendPushToUser(event, userId, {
    title: 'Subscription confirmed',
    body: tierName ? `You're now subscribed to ${tierName}.` : 'Your subscription is now active.',
    url: '/account',
  }).catch(err => console.error('[push] Payment push failed:', err))
}

/**
 * Upserts a subscription row from a verified webhook event. Shared across all three
 * providers — the tier lookup, existing-row check, insert/update, and activation push
 * are identical in shape; only the raw payload parsing that produces a SubscriptionUpsert
 * differs per provider, and stays in each provider's own webhook handler.
 */
export async function upsertSubscriptionFromWebhook(event: H3Event, evt: SubscriptionUpsert): Promise<void> {
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const tier = evt.tierLookupId
    ? await db.query.membershipTiers.findFirst({
        where: and(eq(membershipTiers.siteId, siteId), eq(TIER_LOOKUP_COLUMN[evt.provider], evt.tierLookupId)),
      })
    : null

  const existing = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.providerSubscriptionId, evt.providerSubscriptionId), eq(subscriptions.provider, evt.provider)),
  })

  if (existing) {
    await db.update(subscriptions)
      .set({
        status: evt.status,
        tierId: tier?.id ?? null,
        currentPeriodStart: evt.currentPeriodStart,
        currentPeriodEnd: evt.currentPeriodEnd,
      })
      .where(eq(subscriptions.id, existing.id))
    return
  }

  await db.insert(subscriptions).values({
    id: ulid(),
    siteId,
    userId: evt.userId,
    tierId: tier?.id ?? null,
    provider: evt.provider,
    providerSubscriptionId: evt.providerSubscriptionId,
    providerCustomerId: evt.providerCustomerId,
    status: evt.status,
    currentPeriodStart: evt.currentPeriodStart,
    currentPeriodEnd: evt.currentPeriodEnd,
  })

  if (evt.pushOnActivation && (evt.status === 'active' || evt.status === 'trialing')) {
    await maybeSendPaymentPush(event, evt.userId, tier?.name)
  }
}

/** Marks a subscription cancelled from a verified webhook event. */
export async function cancelSubscriptionFromWebhook(event: H3Event, evt: SubscriptionCancellation): Promise<void> {
  const db = useDb(event)
  await db.update(subscriptions)
    .set({ status: 'cancelled', cancelledAt: evt.cancelledAt ?? new Date().toISOString() })
    .where(and(eq(subscriptions.providerSubscriptionId, evt.providerSubscriptionId), eq(subscriptions.provider, evt.provider)))
}
