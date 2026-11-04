import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { cancelRsvp, confirmRsvp } from '../../../utils/event-rsvp'

const bodySchema = z.object({
  action: z.enum(['confirm', 'cancel']),
  id: z.string().min(1).max(64),
  token: z.string().min(1).max(128),
})

// The buttons on /rsvp/confirm and /rsvp/cancel. A POST from the page rather than the
// emailed link itself, so mail scanners that open every link can't act for the visitor.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'event-rsvp-link' })
  const body = await parseBody(event, bodySchema)
  const result = await (body.action === 'confirm' ? confirmRsvp : cancelRsvp)(event, body.id, body.token)
  if (!result) notFound('This link is not valid.')
  return result
})
