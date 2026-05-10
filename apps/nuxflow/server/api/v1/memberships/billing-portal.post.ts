import { z } from 'zod'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { StripeProvider } from '@nuxflow/plugin-payments/providers/stripe'

const bodySchema = z.object({
  returnUrl: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)
  const config = useRuntimeConfig()

  if (!config.stripeSecretKey) {
    throw createError({ statusCode: 503, message: 'Stripe is not configured' })
  }

  const db = useDb(event)
  const userId = session.user.id as string

  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.siteId, siteId),
      eq(subscriptions.userId, userId),
      eq(subscriptions.provider, 'stripe'),
    ),
    columns: { providerCustomerId: true },
  })

  if (!sub?.providerCustomerId) {
    throw createError({ statusCode: 404, message: 'No active Stripe subscription found' })
  }

  const stripe = new StripeProvider(config.stripeSecretKey as string)
  const portalSession = await stripe.createBillingPortalSession(sub.providerCustomerId, body.returnUrl)

  return { url: portalSession.url }
})
