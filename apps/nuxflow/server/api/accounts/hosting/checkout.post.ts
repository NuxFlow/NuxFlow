import { z } from 'zod'
import { DEFAULT_STARTER_ID } from '../../../utils/starters/builtin'
import { hostingContext, startHostingCheckout } from '../../../utils/hosting-billing'
import { rateLimit } from '../../../utils/rate-limit'
import { starterIdSchema } from '../../../../shared/lib/starters'
import { isKnownStarter } from '../../../utils/starters/install'
import { badRequest } from '../../../utils/response'
import { assertHostingSignupsOpen } from '../../../utils/hosting-platform'

const bodySchema = z.object({
  planId: z.string().min(1),
  interval: z.enum(['month', 'year']),
  subdomain: z.string().min(1).max(64),
  siteName: z.string().trim().min(1).max(100),
  // A starter site id (built in or from the starter catalog).
  template: starterIdSchema.default(DEFAULT_STARTER_ID),
})

/** Starts a hosting sign-up and returns the Stripe Checkout page to send the customer to. */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  await assertHostingSignupsOpen(ctx.db)
  const session = await requireSession(event)
  await rateLimit(event, { limit: 10, windowMs: 60 * 60_000, keyPrefix: 'hosting-checkout' })
  const body = await parseBody(event, bodySchema)
  if (!(await isKnownStarter(event, body.template))) throw badRequest('That starter site is no longer available.')
  return startHostingCheckout(ctx, {
    user: { id: session.user.id, email: session.user.email, name: session.user.name },
    ...body,
  })
})
