import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getPostMailbox, describePostAddress } from '../../../../utils/post-address'
import { users } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

/** The caller's secret post-by-email address on this site, or `{ address: null }`. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [mailbox, user] = await Promise.all([
    getPostMailbox(db, siteId, userId),
    db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true } }),
  ])
  if (!mailbox) return { address: null, senderEmail: user?.email ?? null }

  return {
    address: await describePostAddress(event, db, siteId, mailbox.localPart),
    enabled: mailbox.enabled,
    senderEmail: user?.email ?? null,
    createdAt: mailbox.createdAt,
  }
})
