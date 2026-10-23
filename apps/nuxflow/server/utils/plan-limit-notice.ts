import type { H3Event } from 'h3'
import { and, eq, gte, sql } from 'drizzle-orm'
import { notifications } from '@nuxflow/db/schema'
import { useDb } from './db'
import { notifySiteRole } from './notify'
import type { PlanLimitKey } from '../../shared/lib/hosting-plan-limits'
import { utcDay } from './utc-day'

/**
 * Tells a site's admins, once per limit per month, that something was held back by their
 * hosting plan — for limits hit in the background, where nobody sees a 403 (mail that
 * wasn't kept, attachments that weren't stored). Uses the notifications table itself as
 * the "already told" record, like plan-usage-alerts.ts. Never throws.
 */
export async function noticePlanLimitOnce(event: H3Event, siteId: string, limit: PlanLimitKey, title: string, body: string): Promise<void> {
  try {
    const month = utcDay().slice(0, 7)
    const db = useDb(event)
    const [sent] = await db.select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.siteId, siteId),
        eq(notifications.type, 'system.plan_limit'),
        gte(notifications.createdAt, `${month}-01`),
        sql`json_extract(${notifications.data}, '$.limit') = ${limit}`,
      ))
      .limit(1)
    if (sent) return
    await notifySiteRole(event, {
      siteId,
      minRole: 'admin',
      type: 'system.plan_limit',
      title,
      body,
      data: { limit, month },
      pushUrl: '/admin',
      actionLabel: 'Open dashboard',
      sendEmailNotification: true,
    })
  }
  catch (err) {
    console.error(`[plan-limit] Could not send the ${limit} limit notice for site ${siteId}:`, err)
  }
}
