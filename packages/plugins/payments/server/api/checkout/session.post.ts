import { z } from 'zod'
import { membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { StripeProvider } from '../../providers/stripe'

const bodySchema = z.object({
  tierId: z.string(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  if (!config.stripeSecretKey) {
    throw createError({ statusCode: 503, message: 'Stripe is not configured' })
  }

  const db = useDb()

  const tier = await db.query.membershipTiers.findFirst({
    where: and(eq(membershipTiers.id, body.tierId), eq(membershipTiers.siteId, siteId)),
  })

  if (!tier) throw createError({ statusCode: 404, message: 'Membership tier not found' })
  if (!tier.stripePriceId) throw createError({ statusCode: 409, message: 'This tier has not been synced to Stripe yet' })

  // Resolve the current user to attach their Stripe customer ID
  const session = await getUserSession(event).catch(() => null)
  const userId = session?.user?.id as string | undefined

  const stripe = new StripeProvider(config.stripeSecretKey as string)

  // Create or retrieve Stripe customer
  let customerId: string | undefined
  if (userId && session?.user?.email) {
    const customers = await stripe.listCustomersByEmail(session.user.email as string)
    customerId = customers[0]?.id
    if (!customerId) {
      const customer = await stripe.createCustomer(session.user.email as string, session.user.name as string ?? '')
      customerId = customer.id
    }
  }

  const checkoutSession = await stripe.createCheckoutSession({
    customerId: customerId!,
    priceId: tier.stripePriceId,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
    metadata: userId ? { userId, siteId, tierId: tier.id } : { siteId, tierId: tier.id },
  })

  return { url: checkoutSession.url }
})
