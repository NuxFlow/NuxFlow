import { hostingContext, listCustomerHosting } from '../../../utils/hosting-billing'

/** The signed-in customer's hosted sites and their billing state ("My hosting"). */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  const session = await requireSession(event)
  return { subscriptions: await listCustomerHosting(ctx.db, session.user.id, ctx.primaryEvent) }
})
