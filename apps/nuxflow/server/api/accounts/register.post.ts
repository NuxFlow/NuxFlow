import { z } from 'zod'
import { rateLimit } from '../../utils/rate-limit'
import { registerAccountForSite } from '../../utils/registration'
import { isAccountsHost } from '../../utils/accounts-origin'

const bodySchema = z.object({
  site: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  email: z.email(),
  password: z.string().min(8).max(128),
})

// Self-registration on the accounts origin, always for a particular site (accounts exist
// to take part in sites; there's no free-standing platform sign-up). See
// registerAccountForSite for what it does and why an existing email is a silent no-op.
export default defineEventHandler(async (event) => {
  if (!isAccountsHost(event)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  await rateLimit(event, { limit: 5, windowMs: 60 * 60_000, keyPrefix: 'public-register' })
  const { site, ...body } = await parseBody(event, bodySchema)
  await registerAccountForSite(event, site, body)
  return { success: true }
})
