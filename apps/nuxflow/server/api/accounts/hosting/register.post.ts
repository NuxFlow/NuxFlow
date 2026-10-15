import { z } from 'zod'
import { hostingContext } from '../../../utils/hosting-billing'
import { createPasswordAccount } from '../../../utils/registration'
import { rateLimit } from '../../../utils/rate-limit'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(8).max(128),
})

/**
 * Creates an account for someone signing up for hosting. It joins no site: their own site
 * is created once they've paid. Like site registration, an email that already has an
 * account gets the same answer (no enumeration), and the page then asks them to sign in.
 */
export default defineEventHandler(async (event) => {
  await hostingContext(event)
  await rateLimit(event, { limit: 5, windowMs: 60 * 60_000, keyPrefix: 'hosting-register' })
  const body = await parseBody(event, bodySchema)
  await createPasswordAccount(event, body, `/login?${new URLSearchParams({ verified: '1', next: '/account/hosting/new' })}`)
  return { success: true }
})
