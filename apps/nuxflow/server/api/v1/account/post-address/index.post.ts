import { ulid } from 'ulid'
import { and, eq } from 'drizzle-orm'
import { mailboxes } from '@nuxflow/db/schema'
import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { generatePostLocalPart, getPostMailbox, describePostAddress } from '../../../../utils/post-address'
import { writeAuditLog } from '../../../../utils/audit'
import { rateLimit } from '../../../../utils/rate-limit'
import { requireSiteId } from '../../../../utils/site-context'

/**
 * Creates the caller's post-by-email address, or rotates it (the old address stops
 * working immediately) — the fix when an address leaks.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  await rateLimit(event, { keyPrefix: `post-address:${userId}`, limit: 10, windowMs: 3_600_000 })
  const db = useDb(event)
  const siteId = requireSiteId(event)

  const existing = await getPostMailbox(db, siteId, userId)
  const localPart = generatePostLocalPart()

  if (existing) {
    await db.update(mailboxes).set({ localPart, enabled: true }).where(and(eq(mailboxes.id, existing.id), eq(mailboxes.siteId, siteId)))
  }
  else {
    await db.insert(mailboxes).values({
      id: ulid(),
      siteId,
      localPart,
      name: 'Post by email',
      kind: 'post',
      userId,
      notify: false,
    })
  }
  await writeAuditLog(event, userId, { action: existing ? 'update' : 'create', resource: 'post_address', resourceId: userId })

  return { address: await describePostAddress(event, db, siteId, localPart), enabled: true }
})
