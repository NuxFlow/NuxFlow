import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { verifyTurnstile } from '../../../utils/turnstile'
import { signUp } from '../../../utils/mailing-list'
import { getClientIp } from '../../../utils/client-ip'

const bodySchema = z.object({
  email: z.string().trim().max(254).email(),
  name: z.string().trim().max(100).optional(),
  source: z.enum(['popup', 'block']).default('block'),
  path: z.string().max(500).optional(),
  turnstileToken: z.string().max(4096).optional(),
  // Honeypot: a field hidden from people. Bots that fill every input get a normal-looking
  // answer and nothing is stored.
  website: z.string().max(500).optional(),
})

// Public signup for the site's mailing list — the popup and the Signup box block.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'mailing-list-subscribe' })
  const body = await parseBody(event, bodySchema)

  if (body.website) return { status: 'pending', reward: null }

  const ip = getClientIp(event) ?? undefined
  if (!(await verifyTurnstile(body.turnstileToken ?? '', ip))) validationError('Spam check failed')

  return signUp(event, { email: body.email, name: body.name, source: body.source, path: body.path })
})
