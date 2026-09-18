import { requireRole } from '../../../utils/permissions'
import { saveSetting } from '../../../utils/settings'
import { generateVapidKeys } from '../../../utils/webpush'
import { writeAuditLog } from '../../../utils/audit'
import { useDb } from '../../../utils/db'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const { publicKey, privateKey } = await generateVapidKeys()
  await Promise.all([
    saveSetting(event, 'push.vapid_public_key', publicKey),
    saveSetting(event, 'push.vapid_private_key', privateKey),
  ])

  // Every existing push subscription was created against the OLD application server key —
  // browsers correlate a subscription to the key it was issued under, so rotating the key
  // silently breaks every one of them (pushes to those endpoints just fail forever, with no
  // error surfaced anywhere). Clearing them here is more honest than leaving orphaned rows
  // behind: the subscriber counts shown in the admin UI stay accurate, and a returning
  // visitor's service worker will naturally re-subscribe under the new key.
  const invalidated = await db.delete(pushSubscriptions)
    .where(eq(pushSubscriptions.siteId, siteId))
    .returning({ id: pushSubscriptions.id })

  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'push_vapid_keys',
    after: { rotated: true, invalidatedSubscriptions: invalidated.length },
  })

  return { publicKey, invalidatedSubscriptions: invalidated.length }
})
