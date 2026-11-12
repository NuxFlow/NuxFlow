import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { buildIcsCalendar } from '@nuxflow/canvas/events'
import { appointments, sites } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { verifyAppointmentToken } from '../../../utils/appointments'
import { requireSiteId } from '../../../utils/site-context'
import { parseQuery } from '../../../utils/validate'
import { notFound } from '../../../utils/response'

const querySchema = z.object({ token: z.string().max(128).default('') })

// One appointment's "Add to my calendar" file, linked from its emails. The link carries an
// HMAC of the appointment (server/utils/appointments.ts), so nobody else's can be fetched.
export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id') ?? ''
  const { token } = parseQuery(event, querySchema)
  if (!await verifyAppointmentToken('ics', siteId, id, token)) throw notFound()

  const db = useDb(event)
  const [row, site] = await Promise.all([
    db.query.appointments.findFirst({ where: and(eq(appointments.id, id), eq(appointments.siteId, siteId)) }),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true, timezone: true, name: true } }),
  ])
  if (!row || !site || row.status === 'draft') throw notFound()

  setHeader(event, 'Content-Type', 'text/calendar; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="appointment.ics"')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex')
  return buildIcsCalendar({
    domain: site.domain,
    timeZone: site.timezone || 'UTC',
    events: row.status === 'cancelled'
      ? []
      : [{ id: `appointment-${row.id}`, title: `${row.serviceName} (${site.name})`, eventStartAt: row.startsAt, eventEndAt: row.endsAt, eventAllDay: false, updatedAt: row.updatedAt }],
  })
})
