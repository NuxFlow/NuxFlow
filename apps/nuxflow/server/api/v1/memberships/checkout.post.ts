import { z } from 'zod'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../utils/db'
import { getMembershipTierByIdOrThrow } from '../../../utils/resource-queries'
import { resolveSetting } from '../../../utils/settings'
import { resolveStripeProvider, resolveLemonSqueezyProvider, resolvePaddleProvider } from '../../../utils/payments/resolve'
import { conflict } from '../../../utils/response'

const bodySchema = z.object({
  tierId: z.string(),
  returnUrl: z.string().url(),
})

export default defineEventHandler(async (event) => {
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
      eq(subscriptions.status, 'active'),
    ),
  })
  if (existingActiveSub && existingActiveSub.tierId !== tier.id) {
    throw conflict('You already have an active membership subscription. Manage or cancel it from your account page before subscribing to a different plan.')
  }

  // If the tier is free (price = 0), activate the subscription locally immediately
  if (tier.price === 0) {
    const existing = await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.siteId, siteId),
        eq(subscriptions.tierId, tier.id)
      )
    })

    if (!existing) {
      await db.insert(subscriptions).values({
        id: ulid(),
        siteId,
        userId,
        tierId: tier.id,
        provider: 'stripe',
        providerSubscriptionId: `free_${ulid()}`,
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      })
    } else if (existing.status !== 'active') {
      await db.update(subscriptions)
        .set({
          status: 'active',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(subscriptions.id, existing.id), eq(subscriptions.siteId, siteId)))
    }

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

  if (!stripe && !ls && !paddle) {
    throw createError({ statusCode: 503, message: 'No payment provider is configured' })
  }

  throw conflict(`"${tier.name}" has not been synced to any of the currently configured payment providers. Sync this tier to a configured provider (or configure the provider it's already synced to) before selling it.`)
})
