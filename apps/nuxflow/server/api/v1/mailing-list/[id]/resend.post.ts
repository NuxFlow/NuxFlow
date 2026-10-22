import { and, eq } from 'drizzle-orm'
import { mailingListSubscribers } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { rateLimit } from '../../../../utils/rate-limit'
import { sendConfirmationEmail } from '../../../../utils/mailing-list'
import { requireSiteId } from '../../../../utils/site-context'

// Resends the double opt-in email to someone still pending — e.g. after the site's email
// provider was fixed.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'mailing-list-resend' })
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const id = getRouterParam(event, 'id')!

  const row = await db.query.mailingListSubscribers.findFirst({
    where: and(eq(mailingListSubscribers.id, id), eq(mailingListSubscribers.siteId, siteId)),
    columns: { email: true, status: true },
  })
  if (!row) notFound()
  if (row.status !== 'pending') conflict('Only people waiting to confirm can be sent a confirmation email.')

  try {
    await sendConfirmationEmail(event, siteId, id, row.email)
  }
  catch (err) {
    badRequest(err instanceof Error ? err.message : 'The confirmation email could not be sent.')
  }
  return { sent: true }
})
