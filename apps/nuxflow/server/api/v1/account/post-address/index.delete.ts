import { eq } from 'drizzle-orm'
import { mailboxes } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireAuth } from '../../../../utils/permissions'
import { getPostMailbox } from '../../../../utils/post-address'
import { writeAuditLog } from '../../../../utils/audit'
import { noContent } from '../../../../utils/response'

/** Turns off the caller's post-by-email address. requireAuth, not author — a demoted user can still switch theirs off. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireAuth(event)
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const existing = await getPostMailbox(db, siteId, userId)
  if (existing) {
    await db.delete(mailboxes).where(eq(mailboxes.id, existing.id))
    await writeAuditLog(event, userId, { action: 'delete', resource: 'post_address', resourceId: userId })
  }
  return noContent(event)
})
