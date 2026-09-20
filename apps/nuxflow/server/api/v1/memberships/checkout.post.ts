import { z } from 'zod'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../utils/db'
import { getMembershipTierByIdOrThrow } from '../../../utils/resource-queries'
import { resolveSetting } from '../../../utils/settings'
import { resolveStripeProvider, resolveLemonSqueezyProvider, resolvePaddleProvider } from '../../../utils/payments/resolve'
import { conflict } from '../../../utils/response'
import { isHttpError, errorMessage } from '../../../utils/errors'
import { rateLimit } from '../../../utils/rate-limit'
import { writeAuditLog } from '../../../utils/audit'

const bodySchema = z.object({
  tierId: z.string(),
  returnUrl: z.url(),
})

export default defineEventHandler(async (event) => {
  // Every branch below either calls out to a payment provider (customer lookup/creation,
  // checkout session/transaction creation) or writes a subscription row directly (the
  // free-tier path) — same cost profile as the other external-API-calling mutation routes
  // in this codebase (ai-*, user-invite), which all rate-limit themselves.
  await rateLimit(event, { limit: 10, windowMs: 60_000, keyPrefix: 'membership-checkout' })
  const session = await requireSession(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const db = useDb(event)

  const signupsDisabled = await resolveSetting(event, 'payments.signups_disabled')
  if (signupsDisabled === 'true') {
    const msg = await resolveSetting(event, 'payments.signups_disabled_message')
    throw forbidden((msg as string | null) || 'New signups are temporarily paused.')
  }

  const tier = await getMembershipTierByIdOrThrow(db, siteId, body.tierId)
  if (!tier.isActive) throw conflict('This membership tier is no longer available')

  const userId = session.user.id as string
  const userEmail = session.user.email as string
  const userName = (session.user.name ?? '') as string

  // Guard against a user holding multiple concurrent subscriptions (any tier, any
  // provider) on this site. Resubmitting for the *same* tier stays idempotent — it
  // falls through to the free-tier reactivation branch below, or (for paid tiers) simply
  // re-runs checkout against a provider that will recognize the existing customer.
  const existingActiveSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.siteId, siteId),
      eq(subscriptions.userId, userId),
      inArray(subscriptions.status, ['active', 'trialing']),
    ),
  })
  if (existingActiveSub && existingActiveSub.tierId !== tier.id) {
    throw conflict('You already have an active membership subscription. Manage or cancel it from your account page before subscribing to a different plan.')
  }

  // If the tier is free (price = 0), activate the subscription locally immediately.
  // Uses an atomic upsert (backed by the partial idx_subscriptions_unique_free_tier
  // index) rather than a check-then-write — two concurrent requests for the same free
  // tier would otherwise both see "no existing row" before either commits, inserting
  // duplicate subscriptions.
  if (tier.price === 0) {
    const periodStart = new Date().toISOString()
    const periodEnd = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()

    // `newId` lets us tell insert vs. conflict-triggered update apart without a second
    // read, the same trick upsertSubscriptionFromWebhook uses: on a real insert
    // `RETURNING id` is the id just generated; on a conflict, `id` is untouched by the
    // SET clause below, so it comes back as the pre-existing row's id instead.
    const newId = ulid()
    const [row] = await db.insert(subscriptions).values({
      id: newId,
      siteId,
      userId,
      tierId: tier.id,
      provider: 'stripe',
      providerSubscriptionId: `free_${ulid()}`,
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    }).onConflictDoUpdate({
      target: [subscriptions.siteId, subscriptions.userId, subscriptions.tierId],
      // SQLite requires an ON CONFLICT target's WHERE clause to textually match a
      // partial unique index's own WHERE for the conflict to resolve against it — this
      // must stay identical to idx_subscriptions_unique_free_tier's definition in
      // packages/db/src/schema/payments.ts.
      targetWhere: sql`substr(provider_subscription_id, 1, 5) = 'free_'`,
      set: {
        status: 'active',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        updatedAt: sql`(datetime('now'))`,
      },
    }).returning({ id: subscriptions.id })

    await writeAuditLog(event, userId, {
      action: row?.id === newId ? 'create' : 'update',
      resource: 'subscription',
      resourceId: row?.id ?? newId,
      after: { tierId: tier.id, provider: 'stripe', status: 'active' },
    })

    return { url: body.returnUrl }
  }

  // Resolve payment integration dynamically (per-tenant override of env variables).
  // A tier can only be checked out through the provider it is actually synced to
  // (stripePriceId / lsVariantId / paddleProductId) — picking by global "whichever
  // provider has credentials first" priority instead would fail a tier that's fully
  // synced to, say, Paddle just because Stripe also happens to be configured. When a
  // tier is synced to more than one provider, prefer Stripe > Lemon Squeezy > Paddle
  // among only the ones it's actually synced to.
  const [stripe, ls, paddle] = await Promise.all([
    resolveStripeProvider(event),
    resolveLemonSqueezyProvider(event),
    resolvePaddleProvider(event),
  ])

  // A transient provider outage here happens at exactly the moment a customer is trying to
  // pay — surface it as a clean 502 with a real message instead of letting it bubble up as
  // an unhandled exception, matching the pattern subscription.delete.ts already uses.
  try {
    if (stripe && tier.stripePriceId) {
      const customers = await stripe.listCustomersByEmail(userEmail)
      let customerId = customers[0]?.id
      if (!customerId) {
        const customer = await stripe.createCustomer(userEmail, userName)
        customerId = customer.id
      }
      const checkoutSession = await stripe.createCheckoutSession({
        customerId,
        priceId: tier.stripePriceId,
        successUrl: body.returnUrl,
        cancelUrl: body.returnUrl,
        metadata: { userId, siteId, tierId: tier.id },
      })
      return { url: checkoutSession.url }
    }

    if (ls && tier.lsVariantId) {
      const result = await ls.createCheckout({
        variantId: tier.lsVariantId,
        email: userEmail,
        customData: { user_id: userId, site_id: siteId },
      })
      return { url: result.data.attributes.url }
    }

    if (paddle && tier.paddleProductId) {
      const transaction = await paddle.createTransaction({
        priceId: tier.paddleProductId,
        customData: { user_id: userId, site_id: siteId, tier_id: tier.id },
        returnUrl: body.returnUrl,
      })
      return { url: transaction.data.checkout.url }
    }
  } catch (err) {
    if (isHttpError(err)) throw err
    throw createError({ statusCode: 502, message: `Payment provider checkout failed: ${errorMessage(err)}` })
  }

  if (!stripe && !ls && !paddle) {
    throw createError({ statusCode: 503, message: 'No payment provider is configured' })
  }

  throw conflict(`"${tier.name}" has not been synced to any of the currently configured payment providers. Sync this tier to a configured provider (or configure the provider it's already synced to) before selling it.`)
})
