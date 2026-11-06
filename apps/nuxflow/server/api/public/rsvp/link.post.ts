import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { cancelRsvp, confirmRsvp, describeRsvpLink, payForOffer } from '../../../utils/event-rsvp'

const bodySchema = z.object({
  // `describe-*` only reads, to show someone what a button will do before they press it.
  action: z.enum(['confirm', 'cancel', 'pay', 'describe-cancel', 'describe-pay']),
  id: z.string().min(1).max(64),
  token: z.string().min(1).max(128),
  method: z.enum(['card', 'pass']).default('card'),
})

// The buttons on /rsvp/confirm, /rsvp/cancel and /booking/pay. A POST from the page rather
// than the emailed link itself, so mail scanners that open every link can't act for the visitor.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'event-rsvp-link' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = await parseBody(event, bodySchema)
  const result = await (() => {
    switch (body.action) {
      case 'confirm': return confirmRsvp(event, body.id, body.token)
      case 'cancel': return cancelRsvp(event, body.id, body.token)
      case 'pay': return payForOffer(event, body.id, body.token, body.method)
      case 'describe-cancel': return describeRsvpLink(event, 'cancel', body.id, body.token)
      case 'describe-pay': return describeRsvpLink(event, 'pay', body.id, body.token)
    }
  })()
  if (!result) notFound('This link is not valid.')
  return result
})
