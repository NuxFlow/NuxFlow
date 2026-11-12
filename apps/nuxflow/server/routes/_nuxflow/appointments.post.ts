import { z } from 'zod'
import { ulid } from 'ulid'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { rateLimit } from '../../utils/rate-limit'
import { verifyTurnstile } from '../../utils/turnstile'
import { getClientIp } from '../../utils/client-ip'
import { bookAppointment, cancelAppointmentByLink, cancelAppointmentByTeam, confirmAppointment, resolveService } from '../../utils/appointments'
import { getIntakeForm, intakeFields } from '../../utils/booking-intake'
import { checkFormAnswers, saveFormSubmission } from '../../utils/form-submission'
import { isDemoMode } from '../../utils/demo-mode'
import { useDb } from '../../utils/db'
import { forbidden, notFound, validationError } from '../../utils/response'
import { formatEventWhen } from '@nuxflow/canvas/events'
import { writeAuditLog } from '../../utils/audit'

const link = { id: z.string().max(40), token: z.string().max(128) }
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('book'),
    path: z.string().max(500),
    block: z.string().min(1).max(100),
    start: z.string().max(40),
    name: z.string().trim().min(1, 'Please enter your name').max(100),
    email: z.string().trim().max(254).email(),
    phone: z.string().trim().max(40).optional(),
    note: z.string().trim().max(1000).optional(),
    turnstileToken: z.string().max(4096).optional(),
    // Honeypot: bots that fill every input get a normal-looking answer and nothing is stored.
    website: z.string().max(500).optional(),
    // Answers to the page's intake form, when it has one (server/utils/booking-intake.ts).
    intake: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ action: z.literal('confirm'), ...link }),
  z.object({ action: z.literal('cancel'), ...link }),
  z.object({ action: z.literal('team-cancel'), id: z.string().max(40) }),
])

// One-to-one appointments (server/utils/appointments.ts). Not under /api — see
// appointments.get.ts — so the CSRF middleware (which covers /api/**) doesn't see it:
// requests from another site are refused here instead.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const fetchSite = getRequestHeader(event, 'sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') throw forbidden('Appointments can only be booked from this site')
  const body = await parseBody(event, bodySchema)

  if (body.action === 'team-cancel') {
    const { userId } = await requireRole(event, 'editor')
    const result = await cancelAppointmentByTeam(event, body.id)
    await writeAuditLog(event, userId, { action: 'update', resource: 'appointments', resourceId: body.id, after: { status: 'cancelled', refunded: result.refunded } })
    return result
  }

  await rateLimit(event, { limit: body.action === 'book' ? 5 : 20, windowMs: 60_000, keyPrefix: `appointments-${body.action}` })

  if (body.action === 'confirm' || body.action === 'cancel') {
    const result = body.action === 'confirm'
      ? await confirmAppointment(event, body.id, body.token)
      : await cancelAppointmentByLink(event, body.id, body.token)
    if (!result) throw notFound('This link isn\'t valid.')
    return result
  }

  if (body.website) return { status: 'pending', id: ulid() }
  // Bookings send email and can take money: not something the shared demo login should do.
  if (isDemoMode(event)) throw forbidden('Booking appointments is switched off in the demo.')
  const ip = getClientIp(event) ?? undefined
  if (!(await verifyTurnstile(body.turnstileToken ?? '', ip))) validationError('Spam check failed')

  const ctx = await resolveService(event, body.path, body.block)
  // A waiver or questionnaire must be answered before the booking goes through.
  const form = await getIntakeForm(useDb(event), siteId, ctx.page.sourceItemId ?? ctx.page.id)
  const answers = form ? checkFormAnswers(intakeFields(form), body.intake ?? {}) : null

  const result = await bookAppointment(event, ctx, body)

  if (form && answers) {
    await saveFormSubmission(event, form, {
      id: ulid(),
      data: { ...answers, 'Appointment': `${ctx.service.name} · ${formatEventWhen({ eventStartAt: body.start, eventAllDay: false }, ctx.timeZone, ctx.locale)}`, 'Booked by': `${body.name} <${body.email}>` },
      ip,
    })
  }
  return result
})
