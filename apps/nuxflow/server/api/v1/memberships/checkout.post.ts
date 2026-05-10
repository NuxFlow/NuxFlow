import { z } from 'zod'
import { membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { StripeProvider } from '@nuxflow/plugin-payments/providers/stripe'
import { LemonSqueezyProvider } from '@nuxflow/plugin-payments/providers/lemonsqueezy'

const bodySchema = z.object({
  tierId: z.string(),
  returnUrl: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  const db = useDb(event)
  const tier = await db.query.membershipTiers.findFirst({
    where: and(eq(membershipTiers.id, body.tierId), eq(membershipTiers.siteId, siteId)),
  })
  if (!tier) throw createError({ statusCode: 404, message: 'Membership tier not found' })
  if (!tier.isActive) throw createError({ statusCode: 409, message: 'This membership tier is no longer available' })

  const userId = session.user.id as string
  const userEmail = session.user.email as string
  const userName = (session.user.name ?? '') as string

  if (config.stripeSecretKey) {
    if (!tier.stripePriceId) throw createError({ statusCode: 409, message: 'This tier has not been synced to Stripe' })
    const stripe = new StripeProvider(config.stripeSecretKey as string)
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

  if (config.lsApiKey && config.lsStoreId) {
    if (!tier.lsVariantId) throw createError({ statusCode: 409, message: 'This tier has not been synced to Lemon Squeezy' })
    const ls = new LemonSqueezyProvider(config.lsApiKey as string, config.lsStoreId as string)
    const result = await ls.createCheckout({
      variantId: tier.lsVariantId,
      email: userEmail,
      customData: { user_id: userId, site_id: siteId },
    })
    return { url: result.data.attributes.url }
  }

  if (config.paddleApiKey) {
    if (!tier.paddleProductId) throw createError({ statusCode: 409, message: 'This tier has not been synced to Paddle' })
    const siteUrl = (config.public.siteUrl as string) || 'https://example.com'
    const checkoutUrl = new URL('/checkout', siteUrl)
    checkoutUrl.searchParams.set('product', tier.paddleProductId)
    checkoutUrl.searchParams.set('user_id', userId)
    checkoutUrl.searchParams.set('site_id', siteId)
    return { url: checkoutUrl.toString() }
  }

  throw createError({ statusCode: 503, message: 'No payment provider is configured' })
})
