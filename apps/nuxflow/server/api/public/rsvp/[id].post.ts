import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { verifyTurnstile } from '../../../utils/turnstile'
import { getClientIp } from '../../../utils/client-ip'
import { ulid } from 'ulid'
import { formatEventWhen } from '@nuxflow/canvas/events'
import { getPublicRsvpEvent, RSVP_MAX_SEATS, slotOf, submitRsvp } from '../../../utils/event-rsvp'
import { useDb } from '../../../utils/db'
import { requireSiteId } from '../../../utils/site-context'
import { getIntakeForm, intakeFields } from '../../../utils/booking-intake'
import { checkFormAnswers, saveFormSubmission } from '../../../utils/form-submission'

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
  // Answers to the event's intake form, when it has one (server/utils/booking-intake.ts).
  intake: z.record(z.string(), z.unknown()).optional(),
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

  // An intake form (a waiver, a health questionnaire) must be answered before the booking
  // goes through — checked with the form's own rules, before any place is taken.
  const form = await getIntakeForm(useDb(event), requireSiteId(event), item.id)
  const answers = form ? checkFormAnswers(intakeFields(form), body.intake ?? {}) : null

  const result = await submitRsvp(event, slot, { name: body.name, email: body.email, seats: body.seats, method: body.method })

  if (form && answers) {
    // Saved as an ordinary submission of that form, labelled with the booking it belongs to.
    const when = formatEventWhen({ eventStartAt: slot.eventStartAt ?? '', eventEndAt: slot.eventEndAt, eventAllDay: slot.eventAllDay }, slot.timeZone, slot.locale)
    await saveFormSubmission(event, form, {
      id: ulid(),
      data: { ...answers, 'Booking': `${slot.title} · ${when}`, 'Booked by': `${body.name} <${body.email}>` },
      ip,
    })
  }
  return result
})
