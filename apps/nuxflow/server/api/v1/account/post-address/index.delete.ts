import { eq } from 'drizzle-orm'
import { mailboxes } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireSiteUser } from '../../../../utils/permissions'
import { getPostMailbox } from '../../../../utils/post-address'
import { writeAuditLog } from '../../../../utils/audit'
import { noContent } from '../../../../utils/response'
import { requireSiteId } from '../../../../utils/site-context'

/** Turns off the caller's post-by-email address. requireSiteUser, not author — a demoted user can still switch theirs off. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireSiteUser(event)
  const db = useDb(event)
  const siteId = requireSiteId(event)

  const existing = await getPostMailbox(db, siteId, userId)
  if (existing) {
    await db.delete(mailboxes).where(eq(mailboxes.id, existing.id))
    await writeAuditLog(event, userId, { action: 'delete', resource: 'post_address', resourceId: userId })
  }
  return noContent(event)
})
