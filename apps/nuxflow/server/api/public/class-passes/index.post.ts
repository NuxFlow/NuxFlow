import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { classPasses } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { rateLimit } from '../../../utils/rate-limit'
import { verifyTurnstile } from '../../../utils/turnstile'
import { getClientIp } from '../../../utils/client-ip'
import { requireSiteId } from '../../../utils/site-context'
import { createPassCheckout } from '../../../utils/class-passes'

const bodySchema = z.object({
  passId: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Please enter your name').max(100),
  email: z.string().trim().max(254).email(),
  turnstileToken: z.string().max(4096).optional(),
  // Honeypot, as on the booking form.
  website: z.string().max(500).optional(),
})

// Buying a class pass, with no account: the address given is the one the pass belongs to.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'class-pass-checkout' })
  const body = await parseBody(event, bodySchema)
  if (body.website) return { url: null }

  const ip = getClientIp(event) ?? undefined
  if (!(await verifyTurnstile(body.turnstileToken ?? '', ip))) validationError('Spam check failed')

  const pass = await useDb(event).query.classPasses.findFirst({
    where: and(eq(classPasses.id, body.passId), eq(classPasses.siteId, requireSiteId(event)), eq(classPasses.isActive, true)),
  })
  if (!pass) notFound('This pass isn\'t on sale any more.')
  return { url: await createPassCheckout(event, pass, { email: body.email, name: body.name }) }
})
