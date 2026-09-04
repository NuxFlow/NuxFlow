import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { membershipTiers, subscriptions } from '@nuxflow/db/schema'
import { useDb } from '../db'
import { resolveSetting } from '../settings'
import { sendNotification } from '../notify'
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

/**
 * Verifies the tenant a webhook event claims to belong to (read from a field the
 * provider actually signed — Stripe/LS/Paddle metadata set at checkout, see
 * memberships/checkout.post.ts) matches the site this request resolved to
 * (`event.context.siteId`, derived from the — attacker-controllable — `Host` header).
 *
 * A valid provider signature only proves the payload came from that provider using
 * some site's configured secret; it says nothing about which tenant the event was
 * meant for. Two sites sharing a provider account/secret (a shared payment account, or
 * the documented env-var fallback in `resolveSetting`) would otherwise let a webhook
 * for Site A's subscription be applied to whatever site the request's Host header
 * currently resolves to — including a replay of a legitimately-signed payload against
 * a different Host. Call this before every DB write these handlers make.
 */
export function assertWebhookSiteMatch(event: H3Event, payloadSiteId: string | undefined | null): void {
  const contextSiteId = event.context.siteId as string | undefined
  if (!payloadSiteId || !contextSiteId || payloadSiteId !== contextSiteId) {
    throw createError({ statusCode: 400, message: 'Webhook event site does not match the request site' })
  }
}

async function maybeSendPaymentPush(event: H3Event, siteId: string, userId: string, tierName: string | undefined) {
  const enabled = await resolveSetting(event, 'push.events.payment_confirmation')
  if (enabled !== 'true') return
  await sendNotification({
    siteId,
    userId,
    type: 'payment_confirmation',
    title: 'Subscription confirmed',
    body: tierName ? `You're now subscribed to ${tierName}.` : 'Your subscription is now active.',
    sendPush: true,
    pushUrl: '/account',
  }, event).catch(err => console.error('[notify] Payment notification failed:', err))
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

  // Providers redeliver webhooks with no ordering guarantee — Stripe always sends both
  // checkout.session.completed and customer.subscription.created for one checkout, and
  // either can arrive first or arrive concurrently. A separate existence-check-then-write
  // (the previous approach here) lets two concurrent deliveries both see "no existing
  // row" before either commits, inserting duplicate subscription rows and double-sending
  // the activation push. This does the whole thing as one atomic upsert instead: the
  // unique index on (site_id, provider, provider_subscription_id) makes a genuine insert
  // and a conflict-triggered update mutually exclusive at the SQLite level, so only one
  // concurrent delivery for the same subscription can ever "win" the insert.
  //
  // `newId` lets us tell which branch actually happened without a second read: on a real
  // insert `RETURNING id` is the id we just generated; on a conflict, `id` is left
  // untouched by the SET clause below, so it comes back as the pre-existing row's id.
  const newId = ulid()
  const [row] = await db.insert(subscriptions).values({
    id: newId,
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
    .onConflictDoUpdate({
      target: [subscriptions.siteId, subscriptions.provider, subscriptions.providerSubscriptionId],
      set: {
        status: evt.status,
        tierId: tier?.id ?? null,
        currentPeriodStart: evt.currentPeriodStart,
        currentPeriodEnd: evt.currentPeriodEnd,
        updatedAt: sql`(datetime('now'))`,
      },
    })
    .returning({ id: subscriptions.id })

  const wasInsert = row?.id === newId

  if (wasInsert && evt.pushOnActivation && (evt.status === 'active' || evt.status === 'trialing')) {
    await maybeSendPaymentPush(event, siteId, evt.userId, tier?.name)
  }
}

/** Marks a subscription cancelled from a verified webhook event. */
export async function cancelSubscriptionFromWebhook(event: H3Event, evt: SubscriptionCancellation): Promise<void> {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  await db.update(subscriptions)
    .set({ status: 'cancelled', cancelledAt: evt.cancelledAt ?? new Date().toISOString() })
    .where(and(
      eq(subscriptions.siteId, siteId),
      eq(subscriptions.providerSubscriptionId, evt.providerSubscriptionId),
      eq(subscriptions.provider, evt.provider),
    ))
}
