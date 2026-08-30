import { z } from 'zod'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { getStripeProvider } from '../../../utils/payments/resolve'

const bodySchema = z.object({
  returnUrl: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const stripe = await getStripeProvider(event)

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
    throw notFound('No active Stripe subscription found')
  }

  const portalSession = await stripe.createBillingPortalSession(sub.providerCustomerId, body.returnUrl)

  return { url: portalSession.url }
})
