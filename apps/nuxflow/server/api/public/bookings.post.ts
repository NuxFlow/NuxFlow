import { z } from 'zod'
import { rateLimit } from '../../utils/rate-limit'
import { verifyTurnstile } from '../../utils/turnstile'
import { getClientIp } from '../../utils/client-ip'
import { requireSiteId } from '../../utils/site-context'
import { verifyBookingAccess } from '../../utils/class-passes'
import { listBookingsFor, sendBookingAccessEmail } from '../../utils/event-rsvp'

const bodySchema = z.discriminatedUnion('action', [
  // "Email me a link to my bookings".
  z.object({
    action: z.literal('send-link'),
    email: z.string().trim().max(254).email(),
    turnstileToken: z.string().max(4096).optional(),
    website: z.string().max(500).optional(),
  }),
  // What's on someone's list, from that link.
  z.object({
    action: z.literal('list'),
    email: z.string().trim().max(254).email(),
    expires: z.number().int(),
    token: z.string().min(1).max(128),
  }),
])

// A visitor's own bookings and passes, with no account. The emailed link is the only proof
// of who's asking. A POST, so the address and token stay out of logs and caches here.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'bookings' })
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = await parseBody(event, bodySchema)

  if (body.action === 'list') {
    if (!(await verifyBookingAccess(requireSiteId(event), body.email, body.expires, body.token))) {
      httpError({ status: 403, message: 'This link has expired. Ask for a new one below.' })
    }
    return listBookingsFor(event, body.email)
  }

  // Sending mail gets a tighter limit than reading. Answers the same whatever is on file, so
  // it can't be used to find out who has booked.
  await rateLimit(event, { limit: 3, windowMs: 60_000, keyPrefix: 'bookings-send' })
  if (body.website) return { sent: true }
  const ip = getClientIp(event) ?? undefined
  if (!(await verifyTurnstile(body.turnstileToken ?? '', ip))) validationError('Spam check failed')
  await sendBookingAccessEmail(event, body.email).catch((err) => {
    console.error('[bookings] Access email failed:', err)
  })
  return { sent: true }
})
