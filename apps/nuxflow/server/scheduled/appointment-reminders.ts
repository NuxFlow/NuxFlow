import { inArray } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import { useDb } from '../utils/db'
import { createSystemEvent } from '../utils/system-event'
import { dueReminders, sendAppointmentReminder } from '../utils/appointments'
import type { ScheduledCloudflareContext } from './publish-scheduled'

/** Hourly, across every site: day-before reminders for one-to-one appointments. */
export async function sendAppointmentReminders(cloudflare?: ScheduledCloudflareContext) {
  const db = useDb()
  const due = await dueReminders(db)
  if (due.length === 0) return { reminded: 0 }
  const siteIds = [...new Set(due.map(r => r.siteId))].slice(0, 90)
  const domains = new Map((await db.query.sites.findMany({ where: inArray(sites.id, siteIds), columns: { id: true, domain: true } })).map(s => [s.id, s.domain]))

  let reminded = 0
  for (const row of due) {
    const domain = domains.get(row.siteId)
    if (!domain) continue
    const event = createSystemEvent({ env: cloudflare?.env ?? globalThis.__env__, ctx: cloudflare?.context, siteId: row.siteId, host: domain })
    event.context.publicOrigin = `https://${domain}`
    try {
      if (await sendAppointmentReminder(event, row)) reminded++
    }
    catch (err) {
      console.error(`[appointment-reminders] Reminder for ${row.id} failed:`, err)
    }
  }
  return { reminded }
}
