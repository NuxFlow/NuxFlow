import { z } from 'zod'
import { hostingContext, SITE_TEMPLATES, startHostingCheckout } from '../../../utils/hosting-billing'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  planId: z.string().min(1),
  interval: z.enum(['month', 'year']),
  subdomain: z.string().min(1).max(64),
  siteName: z.string().trim().min(1).max(100),
  template: z.enum(SITE_TEMPLATES).default('landing'),
})

/** Starts a hosting sign-up and returns the Stripe Checkout page to send the customer to. */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  const session = await requireSession(event)
  await rateLimit(event, { limit: 10, windowMs: 60 * 60_000, keyPrefix: 'hosting-checkout' })
  const body = await parseBody(event, bodySchema)
  return startHostingCheckout(ctx, {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    ...body,
  })
})
