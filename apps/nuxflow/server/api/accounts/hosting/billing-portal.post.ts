import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { hostingSubscriptions } from '@nuxflow/db/schema'
import { hostingContext } from '../../../utils/hosting-billing'
import { getStripeProvider } from '../../../utils/payments/resolve'
import { syncPaymentProvider } from '../../../utils/payments/sync'
import { accountsUrl } from '../../../utils/accounts-origin'

const bodySchema = z.object({ id: z.string().min(1) })

/**
 * Opens Stripe's Customer Portal for one of the customer's hosting subscriptions: card,
 * invoices, change plan, cancel. NuxFlow hears about any change through the webhook.
 */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  const session = await requireSession(event)
  const { id } = await parseBody(event, bodySchema)
  const row = await ctx.db.query.hostingSubscriptions.findFirst({
    where: and(eq(hostingSubscriptions.id, id), eq(hostingSubscriptions.ownerUserId, session.user.id)),
    columns: { stripeCustomerId: true },
  })
  if (!row?.stripeCustomerId) throw notFound('Subscription not found')
  const stripe = await getStripeProvider(ctx.primaryEvent)
  const customerId = row.stripeCustomerId
  const portal = await syncPaymentProvider('Stripe', 'open billing portal', () => stripe.createBillingPortalSession(customerId, accountsUrl('/account/hosting')))
  return { url: portal.url }
})
