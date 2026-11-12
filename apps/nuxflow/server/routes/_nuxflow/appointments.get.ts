import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { requireSiteId } from '../../utils/site-context'
import { rateLimit } from '../../utils/rate-limit'
import { describeAppointmentLink, listAppointments, listFreeTimes, resolveService } from '../../utils/appointments'
import { getIntakeForm, publicIntakeForm } from '../../utils/booking-intake'
import { useDb } from '../../utils/db'
import { notFound, validationError } from '../../utils/response'

// One-to-one appointments (server/utils/appointments.ts). Not under /api: one more typed API
// route address tips `nuxt typecheck` into TS2589, and non-/api routes aren't typed.
//   ?path=&block=[&from=]     → the Appointment block: the service and its free times
//   ?do=confirm|cancel&id=&token= → what an emailed link's page shows before its button
//   ?team=upcoming|past       → Admin → Appointments (editor+)
const querySchema = z.object({
  path: z.string().max(500).optional(),
  block: z.string().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  do: z.enum(['confirm', 'cancel']).optional(),
  id: z.string().max(40).optional(),
  token: z.string().max(128).optional(),
  team: z.enum(['upcoming', 'past']).optional(),
})

export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const q = parseQuery(event, querySchema)
  setHeader(event, 'Cache-Control', 'private, no-store')

  if (q.team) {
    await requireRole(event, 'editor')
    return listAppointments(event, q.team)
  }

  await rateLimit(event, { limit: 120, windowMs: 60_000, keyPrefix: 'appointments-read' })
  if (q.do) {
    if (!q.id || !q.token) throw validationError('Missing link')
    const found = await describeAppointmentLink(event, q.do, q.id, q.token)
    if (!found) throw notFound('This link isn\'t valid.')
    return found
  }

  if (q.path === undefined || !q.block) throw validationError('Missing page or block')
  const ctx = await resolveService(event, q.path, q.block)
  const [times, form] = await Promise.all([
    listFreeTimes(event, ctx, q.from),
    getIntakeForm(useDb(event), siteId, ctx.page.sourceItemId ?? ctx.page.id),
  ])
  return { ...times, intake: form ? publicIntakeForm(form) : null }
})
