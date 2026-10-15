import { z } from 'zod'
import { checkSubdomain, hostingContext } from '../../../utils/hosting-billing'
import { rateLimit } from '../../../utils/rate-limit'

const querySchema = z.object({ name: z.string().max(64) })

/** Live "is this address free?" check for the sign-up form. */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  await rateLimit(event, { limit: 60, windowMs: 60_000, keyPrefix: 'hosting-subdomain' })
  const { name } = parseQuery(event, querySchema)
  const session = await getAuthSession(event)
  return checkSubdomain(ctx.db, name, session?.user.id)
})
