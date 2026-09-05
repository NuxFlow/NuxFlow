import { z } from 'zod'
import { subscriptions } from '@nuxflow/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { getStripeProvider } from '../../../utils/payments/resolve'
import { conflict } from '../../../utils/response'

const bodySchema = z.object({
  returnUrl: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const db = useDb(event)
  const userId = session.user.id as string

  // Look up the caller's current subscription (any provider) before assuming Stripe —
  // a site correctly configured for Lemon Squeezy/Paddle should get an honest "billing
  // portal isn't available for your provider" message when the caller actually holds a
  // subscription there, rather than a misleading "Stripe is not configured" 503. The
  // frontend already hides this button for non-Stripe subscribers (see account.vue);
  // this only matters to a direct API caller. When the caller has no subscription at
  // all, fall through to the original "is Stripe configured" check below — that 503 is
  // still the accurate answer in that case.
  const activeSub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.siteId, siteId),
      eq(subscriptions.userId, userId),
      ne(subscriptions.status, 'cancelled'),
    ),
    columns: { provider: true, providerCustomerId: true },
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  })

  if (activeSub && activeSub.provider !== 'stripe') {
    throw conflict('The billing portal is only available for Stripe subscriptions. Manage or cancel your subscription from the account page instead.')
  }

  const stripe = await getStripeProvider(event)

  if (!activeSub?.providerCustomerId) {
    throw notFound('No active Stripe subscription found')
  }

  const portalSession = await stripe.createBillingPortalSession(activeSub.providerCustomerId, body.returnUrl)

  return { url: portalSession.url }
})
