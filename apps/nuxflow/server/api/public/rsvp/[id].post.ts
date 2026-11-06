import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { verifyTurnstile } from '../../../utils/turnstile'
import { getClientIp } from '../../../utils/client-ip'
import { getPublicRsvpEvent, RSVP_MAX_SEATS, slotOf, submitRsvp } from '../../../utils/event-rsvp'

const bodySchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(100),
  email: z.string().trim().max(254).email(),
  seats: z.number().int().min(1).max(RSVP_MAX_SEATS).default(1),
  // Which date of a repeating event.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Paid events: by card now, or with a class pass through an emailed link.
  method: z.enum(['card', 'pass']).optional(),
  turnstileToken: z.string().max(4096).optional(),
  // Honeypot: a field hidden from people. Bots that fill every input get a normal-looking
  // answer and nothing is stored.
  website: z.string().max(500).optional(),
})

// A visitor's booking from the event page.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 5, windowMs: 60_000, keyPrefix: 'event-rsvp' })
  const body = await parseBody(event, bodySchema)
  if (body.website) return { status: 'pending' }

  const ip = getClientIp(event) ?? undefined
  if (!(await verifyTurnstile(body.turnstileToken ?? '', ip))) validationError('Spam check failed')

  const item = await getPublicRsvpEvent(event, getRouterParam(event, 'id')!)
  const slot = slotOf(item, body.date)
  if (!slot) validationError('Please choose a date.')
  return submitRsvp(event, slot, { name: body.name, email: body.email, seats: body.seats, method: body.method })
})
