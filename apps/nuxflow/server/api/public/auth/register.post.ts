import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { registerAccountForSite } from '../../../utils/registration'
import { isTenantHostInCentralMode } from '../../../utils/accounts-origin'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  password: z.string().min(8).max(128),
})

// Registration on a single-site install's own domain. Under central sign-in passwords are
// never taken on a site's domain (see utils/accounts-origin.ts) — registration happens on
// the accounts origin via POST /api/accounts/register instead.
export default defineEventHandler(async (event) => {
  if (isTenantHostInCentralMode(event)) throw createError({ statusCode: 404, statusMessage: 'Register on the accounts site' })
  // Same 5/hour-per-IP limit as the accounts-origin route: this is an unauthenticated
  // account-creation door and would otherwise be an unthrottled enumeration oracle.
  await rateLimit(event, { limit: 5, windowMs: 60 * 60_000, keyPrefix: 'public-register' })
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)
  await registerAccountForSite(event, siteId, body)
  return { success: true }
})
